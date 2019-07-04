/*
Copyright 2019 The Matrix.org Foundation C.I.C.
Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at
    http://www.apache.org/licenses/LICENSE-2.0
Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/
const Datastore = require("nedb");
const fs = require("fs");
const log = require("../log");

const EventBridgeStore = require("../..").EventBridgeStore;
const StoredEvent = require("../..").StoredEvent;
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
            const ev = new StoredEvent(
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
            const ev = new StoredEvent(
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
            const ev = new StoredEvent(
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
            const ev = new StoredEvent(
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
