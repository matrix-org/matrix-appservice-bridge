"use strict";
const log = require("../log");
const StateLookup = require("../..").StateLookup;
const promiseutil = require("../../lib/utils/promiseutil");

describe("StateLookup", function() {
    var lookup, cli;

    beforeEach(
    /** @this */
    function() {
        log.beforeEach(this);
        cli = jasmine.createSpyObj("client", ["roomState"]);
        lookup = new StateLookup({
            eventTypes: ["m.room.member", "m.room.name"],
            client: cli,
            retryStateInMs: 20,
        });
    });

    describe("trackRoom", () => {
        it("should return a Promise which is resolved after the HTTP call " +
        "to /state returns", async() => {
            var statePromise = createStatePromise([]);
            cli.roomState.and.returnValue(statePromise.promise);
            var p = lookup.trackRoom("!foo:bar");
            expect(statePromise.isPending).toBe(true); // not resolved HTTP call yet
            await promiseutil.delay(5);
            expect(statePromise.isPending).toBe(true); // still not resolved HTTP call
            statePromise.resolve();
            await p; // Should resolve now HTTP call is resolved
        });

        it("should return the same Promise if called multiple times with the " +
        "same room ID", function() {
            const statePromise = createStatePromise([]);
            cli.roomState.and.returnValue(statePromise.promise);
            const p = lookup.trackRoom("!foo:bar");
            const q = lookup.trackRoom("!foo:bar");
            expect(p).toBe(q);
        });

        it("should be able to have >1 in-flight track requests at once", async() => {
            const stateA = createStatePromise([]);
            const stateB = createStatePromise([]);
            cli.roomState.and.callFake(function(roomId) {
                if (roomId === "!a:foobar") {
                    return stateA.promise;
                }
                else if (roomId === "!b:foobar") {
                    return stateB.promise;
                }
                throw new Error("Unexpected room ID: " + roomId);
            });
            const promiseA = lookup.trackRoom("!a:foobar");
            const promiseB = lookup.trackRoom("!b:foobar");
            stateA.resolve();
            await promiseA;
            expect(stateB.isPending).toBe(true);
            stateB.resolve();
            await promiseB;
        });

        it("should retry the HTTP call on non 4xx, 5xx errors", async function() {
            // Don't use the clock here, because.
            var count = 0;
            cli.roomState.and.callFake(function(roomId) {
                count += 1;
                if (count < 3) {
                    return Promise.reject(new Error('network error'));
                }
                return Promise.resolve([]);
            })

            await lookup.trackRoom("!foo:bar");
            expect(count).toBe(3);
        });

        it("should fail the promise if the HTTP call returns 4xx", function(done) {
            cli.roomState.and.callFake(function(roomId) {
                return Promise.reject({
                    httpStatus: 403
                });
            });

            lookup.trackRoom("!foo:bar").catch(function(err) {
                expect(err.httpStatus).toBe(403);
                done();
            });
        });

        it("should fail the promise if the HTTP call returns 5xx", function(done) {
            cli.roomState.and.callFake(function(roomId) {
                return Promise.reject({
                    httpStatus: 500
                });
            });

            lookup.trackRoom("!foo:bar").catch(function(err) {
                expect(err.httpStatus).toBe(500);
                done();
            });
        });
    });

    describe("onEvent", () => {
        it("should update the state lookup map", async() => {
            cli.roomState.and.callFake(async(roomId) => {
                return [{
                    type: "m.room.name",
                    state_key: "",
                    room_id: "!foo:bar",
                    content: { name: "Foo" },
                }];
            });

            await lookup.trackRoom("!foo:bar")
            expect(
                lookup.getState("!foo:bar", "m.room.name", "").content.name
            ).toEqual("Foo");
            lookup.onEvent(
                {type: "m.room.name", state_key: "", room_id: "!foo:bar",
                    content: { name: "Bar" }}
            );
            expect(
                lookup.getState("!foo:bar", "m.room.name", "").content.name
            ).toEqual("Bar");
        });

        it("should clobber events from in-flight track requests", async() => {
            var statePromise = createStatePromise([
                {type: "m.room.name", state_key: "", room_id: "!foo:bar",
                        content: { name: "Foo" }}
            ]);
            cli.roomState.and.returnValue(statePromise.promise);
            var p = lookup.trackRoom("!foo:bar");
            expect(statePromise.isPending).toBe(true); // not resolved HTTP call yet
            // this event should clobber response from HTTP call
            statePromise.resolve();
            await lookup.onEvent(
                {type: "m.room.name", state_key: "", room_id: "!foo:bar",
                    content: { name: "Bar" }}
            );
            await p;
            expect(
                lookup.getState("!foo:bar", "m.room.name", "").content.name
            ).toEqual("Bar");
        });
    });

    describe("getState", () => {
        beforeEach(async() => {
            cli.roomState.and.callFake(async(roomId) => {
                return [
                    {type: "m.room.name", state_key: "", content: { name: "Foo" }},
                    {type: "m.room.topic", state_key: "", content: { name: "Bar" }},
                    {type: "m.room.member", state_key: "@alice:bar", content: {
                        displayname: "Alice",
                        membership: "join"
                    }},
                    {type: "m.room.member", state_key: "@bob:bar", content: {
                        displayname: "Bob",
                        membership: "invite"
                    }},
                ];
            });

            await lookup.trackRoom("!foo:bar");
        });

        it("should return null for no match with state_key", function() {
            expect(lookup.getState("!foo:bar", "m.room.colour", "")).toBe(null);
        });

        it("should return a 0-length array for no match without state_key", function() {
            expect(lookup.getState("!foo:bar", "m.room.colour")).toEqual([]);
        });

        it("should return the event for a match with state_key", function() {
            expect(lookup.getState("!foo:bar", "m.room.name", "")).toEqual(
                {type: "m.room.name", state_key: "", content: { name: "Foo" }}
            );
        });

        it("should return a list of events for matches without state_key", function() {
            expect(lookup.getState("!foo:bar", "m.room.member").sort()).toEqual([
                {type: "m.room.member", state_key: "@alice:bar", content: {
                    displayname: "Alice",
                    membership: "join"
                }},
                {type: "m.room.member", state_key: "@bob:bar", content: {
                    displayname: "Bob",
                    membership: "invite"
                }}
            ].sort());
        });
    });
});

function createStatePromise(returnedStateEvents, rejectErr) {
    var resolver;
    var rejecter;
    var p = new Promise(function(resolve, reject) {
        resolver = resolve;
        rejecter = reject;
    });
    let isPending = true;
    return {
        resolve: function() {
            isPending = false;
            resolver(returnedStateEvents);
        },
        reject: function() {
            isPending = false;
            rejecter(rejectErr);
        },
        isPending,
        promise: p
    };
}
