"use strict";
var Promise = require("bluebird");
var log = require("../log");
var StateLookup = require("../..").StateLookup;

describe("StateLookup", function() {
    var lookup, cli;

    beforeEach(
    /** @this */
    function() {
        log.beforeEach(this);
        cli = jasmine.createSpyObj("client", ["roomState"]);
        lookup = new StateLookup({
            eventTypes: ["m.room.member", "m.room.name"],
            client: cli
        });
    });

    describe("trackRoom", function() {
        it("should return a Promise which is resolved after the HTTP call " +
        "to /state returns", function(done) {
            var statePromise = createStatePromise([]);
            cli.roomState.andReturn(statePromise.promise);
            var p = lookup.trackRoom("!foo:bar");
            expect(p.isPending()).toBe(true); // not resolved HTTP call yet
            Promise.delay(5).then(function() {
                expect(p.isPending()).toBe(true); // still not resolved HTTP call
                statePromise.resolve();
                return p; // Should resolve now HTTP call is resolved
            }).then(function() {
                done();
            });
        });

        it("should return the same Promise if called multiple times with the " +
        "same room ID", function() {
            var statePromise = createStatePromise([]);
            cli.roomState.andReturn(statePromise.promise);
            var p = lookup.trackRoom("!foo:bar");
            var q = lookup.trackRoom("!foo:bar");
            expect(p).toBe(q);
        });

        it("should be able to have >1 in-flight track requests at once", function(done) {
            var stateA = createStatePromise([]);
            var stateB = createStatePromise([]);
            cli.roomState.andCallFake(function(roomId) {
                if (roomId === "!a:foobar") {
                    return stateA.promise;
                }
                else if (roomId === "!b:foobar") {
                    return stateB.promise;
                }
                throw new Error("Unexpected room ID: " + roomId);
            });
            var promiseA = lookup.trackRoom("!a:foobar");
            var promiseB = lookup.trackRoom("!b:foobar");
            stateA.resolve();
            promiseA.then(function() {
                expect(promiseB.isPending()).toBe(true);
                stateB.resolve();
                return promiseB;
            }).then(function() {
                done();
            });
        });

        it("should retry the HTTP call on non 4xx, 5xx errors", function(done) {
            jasmine.Clock.useMock();
            var count = 0;
            cli.roomState.andCallFake(function(roomId) {
                count += 1;
                if (count < 3) {
                    // We need to tick time only *AFTER* the rejection handler
                    // for StateLookup runs (which sets the timer going), hence
                    // the catch => nextTick magic.
                    var p = Promise.reject(new Error("network error"));
                    p.catch(function(err) {
                        process.nextTick(function() {
                            jasmine.Clock.tick(10 * 1000); // 10s
                        });
                    });
                    return p;
                }
                return Promise.resolve([]);
            });

            lookup.trackRoom("!foo:bar").then(function() {
                expect(count).toBe(3);
                done();
            });
        });

        it("should fail the promise if the HTTP call returns 4xx", function(done) {
            cli.roomState.andCallFake(function(roomId) {
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
            cli.roomState.andCallFake(function(roomId) {
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

    describe("onEvent", function() {
        it("should update the state lookup map", function(done) {
            cli.roomState.andCallFake(function(roomId) {
                return Promise.resolve([
                    {type: "m.room.name", state_key: "", room_id: "!foo:bar",
                        content: { name: "Foo" }}
                ]);
            });

            lookup.trackRoom("!foo:bar").then(function() {
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
                done();
            });
        });

        it("should clobber events from in-flight track requests", function(done) {
            var statePromise = createStatePromise([
                {type: "m.room.name", state_key: "", room_id: "!foo:bar",
                        content: { name: "Foo" }}
            ]);
            cli.roomState.andReturn(statePromise.promise);
            var p = lookup.trackRoom("!foo:bar");
            expect(p.isPending()).toBe(true); // not resolved HTTP call yet
            // this event should clobber response from HTTP call
            lookup.onEvent(
                {type: "m.room.name", state_key: "", room_id: "!foo:bar",
                    content: { name: "Bar" }}
            );
            statePromise.resolve();

            p.then(function() {
                expect(
                    lookup.getState("!foo:bar", "m.room.name", "").content.name
                ).toEqual("Bar");
                done();
            });
        });
    });

    describe("getState", function() {
        beforeEach(function(done) {
            cli.roomState.andCallFake(function(roomId) {
                return Promise.resolve([
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
                ]);
            });

            lookup.trackRoom("!foo:bar").then(function() {
                done();
            });
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
    return {
        resolve: function() {
            resolver(returnedStateEvents);
        },
        reject: function() {
            rejecter(rejectErr);
        },
        promise: p
    };
}
