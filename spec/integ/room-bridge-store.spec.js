"use strict";
var Datastore = require("nedb");
var fs = require("fs");
var log = require("../log");

var RoomBridgeStore = require("../..").RoomBridgeStore;
var MatrixRoom = require("../..").MatrixRoom;
var RemoteRoom = require("../..").RemoteRoom;
var TEST_DB_PATH = __dirname + "/test.db";

describe("RoomBridgeStore", function() {
    var store, db;

    beforeEach(
    /** @this */
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
                store = new RoomBridgeStore(db);
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

    describe("upsertEntry", function() {
        it("should insert an entry and should be retrievable by getEntryById",
        function(done) {
            var entry = {
                id: "flibble",
                matrix: new MatrixRoom("!foo:bar"),
                remote: new RemoteRoom("#flibble"),
            };
            store.upsertEntry(entry).then(function() {
                return store.getEntryById("flibble");
            }).done(function(e) {
                expect(e.id).toEqual(entry.id);
                expect(e.matrix.getId()).toEqual("!foo:bar");
                expect(e.remote.getId()).toEqual("#flibble");
                done();
            });
        });

        it("should update an entry if one with the same 'id' exists", function(done) {
            var entry = {
                id: "flibble",
                matrix: new MatrixRoom("!foo:bar"),
                remote: new RemoteRoom("#flibble"),
            };
            store.upsertEntry(entry).then(function() {
                var entry2 = {
                    id: "flibble",
                    matrix: new MatrixRoom("!woo:bar"),
                    remote: new RemoteRoom("#wibble"),
                };
                return store.upsertEntry(entry2);
            }).then(function() {
                return store.getEntryById("flibble");
            }).done(function(e) {
                expect(e.id).toEqual("flibble");
                expect(e.matrix.getId()).toEqual("!woo:bar");
                expect(e.remote.getId()).toEqual("#wibble");
                done();
            });
        });
    });

    describe("getEntryById", function() {

        it("should return nothing for matching matrix_id or remote_id", function(done) {
            var entry = {
                id: "flibble",
                matrix: new MatrixRoom("!nothing:here"),
                remote: new RemoteRoom("!nothing:here"),
            };
            store.upsertEntry(entry).then(function() {
                return store.getEntryById("!nothing:here");
            }).done(function(e) {
                expect(e).toBeNull();
                done();
            });
        });
    });

    describe("getEntriesByRemoteRoomData", function() {

        it("should return entries based on remote room data", function(done) {
            var entry = {
                id: "flibble",
                matrix: new MatrixRoom("!nothing:here"),
                remote: new RemoteRoom("#foo"),
            };
            entry.remote.set("custom", "abc123");
            store.upsertEntry(entry).then(function() {
                return store.getEntriesByRemoteRoomData({
                    custom: "abc123"
                });
            }).done(function(e) {
                expect(e).toBeDefined();
                if (!e) {
                    done();
                    return;
                }
                expect(e.length).toEqual(1);
                if (!e[0]) {
                    done();
                    return;
                }
                expect(e[0].remote.getId()).toEqual("#foo");
                done();
            });
        });
    });

    describe("getEntriesByMatrixRoomData", () => {

        it("should return entries based on matrix room data", async(done) => {
            const entry = {
                id: "flibble",
                matrix: new MatrixRoom("!nothing:here"),
                remote: new RemoteRoom("#foo"),
            };
            entry.matrix.set("custom", "abc123");
            store.upsertEntry(entry);
            const e = await store.getEntriesByMatrixRoomData({
                custom: "abc123"
            });
            expect(e).toBeDefined();
            if (!e) {
                done();
                return;
            }
            expect(e.length).toEqual(1);
            if (!e[0]) {
                done();
                return;
            }
            expect(e[0].matrix.getId()).toEqual("!nothing:here");
            done();
        });
    });

    describe("removeEntriesByRemoteRoomData", function() {
        it("should remove entries based on remote room data", function(done) {
            var entry = {
                id: "flibble",
                matrix: new MatrixRoom("!nothing:here"),
                remote: new RemoteRoom("#foo"),
            };
            entry.remote.set("custom", "abc123");
            store.upsertEntry(entry).then(function() {
                return store.getEntryById("flibble");
            }).then(function(e) {
                expect(e).not.toBeNull();
                return store.removeEntriesByRemoteRoomData({
                    custom: "abc123"
                });
            }).then(function() {
                return store.getEntryById("flibble");
            }).done(function(e) {
                expect(e).toBeNull();
                done();
            });
        });
    });

    describe("removeEntriesByMatrixRoomData", function() {
        it("should remove entries based on matrix room data", function(done) {
            var entry = {
                id: "flibble",
                matrix: new MatrixRoom("!nothing:here"),
                remote: new RemoteRoom("#foo"),
            };
            entry.matrix.set("custom", "abc123");
            var entry2 = {
                id: "wibble",
                matrix: new MatrixRoom("!foo:bar")
            };
            entry2.matrix.set("custom", "abc123");
            store.upsertEntry(entry).then(function() {
                return store.upsertEntry(entry2);
            }).then(function() {
                return [
                    store.getEntryById("flibble"),
                    store.getEntryById("wibble")
                ];
            }).spread(function(e, f) {
                expect(e).not.toBeNull();
                expect(f).not.toBeNull();
                return store.removeEntriesByMatrixRoomData({
                    custom: "abc123"
                });
            }).then(function() {
                return [
                    store.getEntryById("flibble"),
                    store.getEntryById("wibble")
                ];
            }).spread(function(e, f) {
                expect(e).toBeNull();
                expect(f).toBeNull();
                done();
            });
        });
    });

    describe("removeEntriesByLinkData", function() {
        it("should remove entries based on link data", function(done) {
            var entry = {
                id: "flibble",
                matrix: new MatrixRoom("!nothing:here"),
                remote: new RemoteRoom("#foo"),
                data: {
                    foo: "bar"
                }
            };
            store.linkRooms(entry.matrix, entry.remote, entry.data).then(function() {
                return store.getEntriesByLinkData({foo: "bar"});
            }).then(function(e) {
                expect(e.length).toEqual(1);
                return store.removeEntriesByLinkData({
                    foo: "bar"
                });
            }).then(function() {
                return store.getEntriesByLinkData({foo: "bar"});
            }).done(function(e) {
                expect(e.length).toEqual(0);
                done();
            });
        });
    });

    describe("getEntriesByMatrixId", () => {
        it("should return for matching matrix_ids", async() => {
            const entry = {
                id: "id1", matrix: new MatrixRoom("!foo:bar"),
                remote: new RemoteRoom("#foo")
            };
            const entry2 = {
                id: "id2", matrix: new MatrixRoom("!foo:bar"),
                remote: new RemoteRoom("#bar")
            };
            await Promise.all(
                [store.upsertEntry(entry), store.upsertEntry(entry2)]
            );
            const results = await store.getEntriesByMatrixId("!foo:bar");
            expect(results.length).toEqual(2);
            const remoteIds = results.map((res) => res.remote.getId());
            expect(remoteIds.sort()).toEqual(["#bar", "#foo"]);
        });
    });

    describe("getEntriesByMatrixIds", () => {
        it("should return a map of room_id to entry", async() => {
            const entries = [
                {
                    id: "id1",
                    matrix: new MatrixRoom("!foo:bar"),
                    remote: new RemoteRoom("#foo"),
                },
                {
                    id: "id2",
                    matrix: new MatrixRoom("!foo:bar"),
                    remote: new RemoteRoom("#bar"),
                },
                {
                    id: "id3",
                    matrix: new MatrixRoom("!fizz:buzz"),
                    remote: new RemoteRoom("#fizz"),
                },
                {
                    id: "id4",
                    matrix: new MatrixRoom("!zzz:zzz"),
                    remote: new RemoteRoom("#buzz"),
                },
            ];
            await Promise.all(
                entries.map((e) => store.upsertEntry(e))
            );
            const results = await store.getEntriesByMatrixIds(["!foo:bar", "!fizz:buzz"]);
            expect(results["!foo:bar"].length).toEqual(2);
            expect(results["!fizz:buzz"].length).toEqual(1);
            expect(results["!fizz:buzz"][0].remote.getId()).toEqual("#fizz");
            expect(results["!foo:bar"].map((e) => e.remote.getId()).sort()).toEqual(["#bar", "#foo"]);
        });
    });

    describe("getEntriesByRemoteId", () => {
        it("should return for matching remote_ids", async() => {
            const entry = {
                id: "id1", matrix: new MatrixRoom("!foo:bar"),
                remote: new RemoteRoom("#foo"),
            };
            const entry2 = {
                id: "id2", matrix: new MatrixRoom("!foo:bar"),
                remote: new RemoteRoom("#bar"),
            };
            await Promise.all(
                [store.upsertEntry(entry), store.upsertEntry(entry2)]
            );
            const results = await store.getEntriesByRemoteId("#foo");
            expect(results.length).toEqual(1);
            expect(results[0].matrix.getId()).toEqual("!foo:bar");
        });
    });

    describe("linkRooms", () => {
        it("should create a single entry", async() => {
            const m = new MatrixRoom("!foo:bar");
            m.set("mxkey", "mxval");
            const r = new RemoteRoom("#foo");
            r.set("remotekey", { "nested": "remote_val"});
            await store.linkRooms(m, r,
                { some: "data_goes_here" },
                "_custom_id"
            );
            const entry = await store.getEntryById("_custom_id");
            expect(entry.id).toEqual("_custom_id");
            expect(entry.remote.getId()).toEqual("#foo");
            expect(entry.remote.get("remotekey")).toEqual({nested: "remote_val"});
            expect(entry.matrix.getId()).toEqual("!foo:bar");
            expect(entry.matrix.get("mxkey")).toEqual("mxval");
            expect(entry.data).toEqual({some: "data_goes_here"});
        });
    });
});
