"use strict";
const Datastore = require("nedb");
const fs = require("fs");
const log = require("../log");

const EventBridgeStore = require("../..").EventBridgeStore;
const StoreEvent = require("../..").StoreEvent;
var TEST_DB_PATH = __dirname + "/test.db";

describe("EventBridgeStore", function() {
    var store, db;

    beforeEach(
    /** @this TestCase */
    function(done) {
        log.beforeEach(this);
        db = new Datastore({
            filename: TEST_DB_PATH,
            autoload: true,
            onload: function(err) {
                if (err) {
                    console.error(err);
                    return;
                }
                store = new EventBridgeStore(db);
                done();
            }
        });
    });

    afterEach(function() {
        try {
            fs.unlinkSync(TEST_DB_PATH);
        }
        catch (e) {
            // do nothing
        }
    });

    describe("upsertEvent", function() {
        it("should be able to store a SourceEvent, retrievable again via getEntryBy(Matrix|Remote)Id",
        function(done) {
            const ev = new StoreEvent(
                "!room:bar",
                "$event:bar",
                "remoteroom:bar",
                "remoteevent:bar"
            );
            store.upsertEvent(ev).then(() => {
                return store.getEntryByMatrixId("!room:bar", "$event:bar");
            }).then((res) => {
                expect(res).toBeDefined();
                expect(res.getId()).toEqual(ev.getId());
                return store.getEntryByRemoteId("remoteroom:bar", "remoteevent:bar");
            }).then((res) => {
                expect(res.getId()).toEqual(ev.getId());
                done();
            });
        });
    });

    describe("removeEvent", function() {
        it("should be able to remove a SourceEvent",
        function(done) {
            const ev = new StoreEvent(
                "!room:bar",
                "$event:bar",
                "remoteroom:bar",
                "remoteevent:bar"
            );
            store.upsertEvent(ev).then(() => {
                return store.removeEvent(ev);
            }).then(() => {
                return store.getEntryByMatrixId("remoteroom:bar", "remoteevent:bar");
            }).then((res) => {
                expect(res).toBeNull();
                done();
            });
        });
    });

    describe("removeEventByMatrixId", function() {
        it("should be able to remove a SourceEvent",
        function(done) {
            const ev = new StoreEvent(
                "!room:bar",
                "$event:bar",
                "remoteroom:bar",
                "remoteevent:bar"
            );
            store.upsertEvent(ev).then(() => {
                return store.removeEventByMatrixId("!room:bar", "$event:bar");
            }).then(() => {
                return store.getEntryByMatrixId("remoteroom:bar", "remoteevent:bar");
            }).then((res) => {
                expect(res).toBeNull();
                done();
            });
        });
    });

    describe("removeEventByRemoteId", function() {
        it("should be able to remove a SourceEvent",
        function(done) {
            const ev = new StoreEvent(
                "!room:bar",
                "$event:bar",
                "remoteroom:bar",
                "remoteevent:bar"
            );
            store.upsertEvent(ev).then(() => {
                return store.removeEventByRemoteId("remoteroom:bar", "remoteevent:bar");
            }).then(() => {
                return store.getEntryByMatrixId("remoteroom:bar", "remoteevent:bar");
            }).then((res) => {
                expect(res).toBeNull();
                done();
            });
        });
    });
});
