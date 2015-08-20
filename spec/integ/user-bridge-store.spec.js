"use strict";
var Datastore = require("nedb");
var fs = require("fs");
var log = require("../log");

var UserBridgeStore = require("../..").UserBridgeStore;
var MatrixUser = require("../..").MatrixUser;
var JungleUser = require("../..").JungleUser;
var TEST_DB_PATH = __dirname + "/test.db";

describe("UserBridgeStore", function() {
    var store, db;

    beforeEach(function(done) {
        log.beforeEach(this);
        db = new Datastore({
            filename: TEST_DB_PATH,
            autoload: true,
            onload: function(err) {
                if (err) {
                    console.error(err);
                    return;
                }
                store = new UserBridgeStore(db);
                done();
            }
        });
    });

    afterEach(function() {
        fs.unlinkSync(TEST_DB_PATH);
    });

    describe("storeMatrixUser", function() {
        it("should be able to store a Matrix user, retrievable again via getByMatrixId",
        function(done) {
            var userId = "@foo:bar";
            var user = new MatrixUser(userId);
            user.setDisplayName("Foo");
            store.storeMatrixUser(user).then(function() {
                return store.getByMatrixId(userId);
            }).done(function(userFromStore) {
                expect(userFromStore.getId()).toEqual(userId);
                expect(userFromStore.getDisplayName()).toEqual("Foo");
                done();
            });
        });
    });

    describe("storeJungleUser", function() {
        it("should be able to store a Jungle user, retrievable again via getByJungleId",
        function(done) {
            var jungleId = "some_unique_id";
            var user = new JungleUser(jungleId);
            store.storeJungleUser(user).then(function() {
                return store.getByJungleId(jungleId);
            }).done(function(userFromStore) {
                expect(userFromStore.getId()).toEqual(jungleId);
                done();
            });
        });

        it("should fully persist all types of primitive data", function(done) {
            var jungleId = "some_unique_id";
            var user = new JungleUser(jungleId);
            user.set("int", 42);
            user.set("str", "the answer");
            user.set("bool", true);
            user.set("obj", {
                foo: "bar",
                baz: {
                    buzz: true
                }
            });
            store.storeJungleUser(user).then(function() {
                return store.getByJungleId(jungleId);
            }).done(function(userFromStore) {
                expect(userFromStore.getId()).toEqual(jungleId);
                expect(userFromStore.get("int")).toEqual(42);
                expect(userFromStore.get("str")).toEqual("the answer");
                expect(userFromStore.get("bool")).toEqual(true);
                expect(userFromStore.get("obj")).toEqual({
                    foo: "bar",
                    baz: {
                        buzz: true
                    }
                });
                done();
            });
        });

        it("should not persist functions", function(done) {
            var jungleId = "some_unique_id";
            var user = new JungleUser(jungleId);
            user.set("fn", function(foo) {
                return 42;
            });
            store.storeJungleUser(user).then(function() {
                return store.getByJungleId(jungleId);
            }).done(function(userFromStore) {
                expect(userFromStore.getId()).toEqual(jungleId);
                expect(userFromStore.get("fn")).toBeUndefined();
                done();
            });
        });
    });

    describe("getByJungleData", function() {
        it("should be able to retrieve via top level keys", function() {

        });

        it("should be able to retrieve via nested keys", function() {

        });

        it("should be able to use basic NoSQL $commands", function() {

        });
    });

    describe("getMatrixUsersFromJungleId", function() {
        it("should return an empty array if there are no matches", function() {

        });

        it("should return a list of users for multiple matches", function() {

        });

        it("should return a single element list for a single match", function() {

        });
    });

    describe("getJungleUsersFromMatrixId", function() {
        it("should return an empty array if there are no matches", function() {

        });

        it("should return a list of users for multiple matches", function() {

        });

        it("should return a single element list for a single match", function() {

        });
    });
});