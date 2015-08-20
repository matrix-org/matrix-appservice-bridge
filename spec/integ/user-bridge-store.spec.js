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
        var jungleId = "some_unique_id";

        beforeEach(function(done) {
            var user = new JungleUser(jungleId);
            user.set("topLevel", 7);
            user.set("nested", {
                foo: "bar",
                baz: {
                    buzz: true
                }
            });
            store.storeJungleUser(user).done(function() {
                done();
            });
        });

        it("should be able to retrieve via top level keys", function(done) {
            store.getByJungleData({
                topLevel: 7
            }).done(function(users) {
                expect(users.length).toEqual(1);
                var u = users[0];
                if (!u) {
                    done();
                    return;
                }
                expect(u.getId()).toEqual(jungleId);
                done();
            });
        });

        it("should be able to retrieve via nested keys", function(done) {
            store.getByJungleData({
                "nested.baz.buzz": true
            }).done(function(users) {
                expect(users.length).toEqual(1);
                var u = users[0];
                if (!u) {
                    done();
                    return;
                }
                expect(u.getId()).toEqual(jungleId);
                done();
            });
        });

        it("should be able to use basic NoSQL $commands", function(done) {
            store.getByJungleData({
                topLevel: {
                    $gt: 3 // greater than 3
                }
            }).done(function(users) {
                expect(users.length).toEqual(1);
                var u = users[0];
                if (!u) {
                    done();
                    return;
                }
                expect(u.getId()).toEqual(jungleId);
                done();
            });
        });
    });

    describe("linkUserIds", function() {
        it("should link a matrix and jungle ID which can be retrieved via getXFromY",
        function(done) {
            var mx = new MatrixUser("@foo:bar");
            var jng = new JungleUser("jungle.id");
            store.linkUsers(mx, jng, true).then(function() {
                return store.getMatrixUsersFromJungleId("jungle.id");
            }).done(function(results) {
                expect(results.length).toEqual(1);
                done();
            });
        });
    });

    describe("getMatrixUsersFromJungleId", function() {

        beforeEach(function(done) {
            // @a:bar --- a_1        @b:bar ----- b_1   @c:bar ---- c_1
            //                      @bb:bar _ /              \_____ c_2
            //                     @bbb:bar _/

            store.linkUsers(new MatrixUser("@a:bar"), new JungleUser("a_1"), true).then(
            function() {
                return store.linkUsers(
                    new MatrixUser("@b:bar"), new JungleUser("b_1"), true
                );
            }).then(function() {
                return store.linkUsers(
                    new MatrixUser("@bb:bar"), new JungleUser("b_1"), true
                );
            }).then(function() {
                return store.linkUsers(
                    new MatrixUser("@bbb:bar"), new JungleUser("b_1"), true
                );
            }).then(function() {
                return store.linkUsers(
                    new MatrixUser("@c:bar"), new JungleUser("c_1"), true
                );
            }).then(function() {
                return store.linkUsers(
                    new MatrixUser("@c:bar"), new JungleUser("c_2"), true
                );
            }).done(function() {
                done();
            });
        });


        it("should return an empty array if there are no matches", function(done) {
            store.getMatrixUsersFromJungleId("nothing").done(function(res) {
                expect(res.length).toEqual(0);
                done();
            });
        });

        it("should return a list of users for multiple matches", function(done) {
            store.getMatrixUsersFromJungleId("b_1").done(function(res) {
                expect(res.length).toEqual(3);
                res.forEach(function(usr) {
                    expect(
                        ["@b:bar", "@bb:bar", "@bbb:bar"].indexOf(usr.getId())
                    ).not.toEqual(-1);
                })
                done();
            });
        });

        it("should return a single element list for a single match", function(done) {
            store.getMatrixUsersFromJungleId("a_1").done(function(res) {
                expect(res.length).toEqual(1);
                expect(res[0].getId()).toEqual("@a:bar");
                done();
            });
        });

        describe("getMatrixLinks", function() {
            it("should return a single element list for a single match",
            function(done) {
                store.getMatrixLinks("a_1").done(function(res) {
                    expect(res.length).toEqual(1);
                    expect(res[0]).toEqual("@a:bar");
                    done();
                });
            });
        });
    });

    describe("getJungleUsersFromMatrixId", function() {

        beforeEach(function(done) {
            // @a:bar --- a_1        @b:bar ----- b_1
            //         \_ a_2
            //         \_ a_3

            store.linkUsers(new MatrixUser("@a:bar"), new JungleUser("a_1"), true).then(
            function() {
                return store.linkUsers(
                    new MatrixUser("@a:bar"), new JungleUser("a_2"), true
                );
            }).then(function() {
                return store.linkUsers(
                    new MatrixUser("@a:bar"), new JungleUser("a_3"), true
                );
            }).then(function() {
                return store.linkUsers(
                    new MatrixUser("@b:bar"), new JungleUser("b_1"), true
                );
            }).done(function() {
                done();
            });
        });

        it("should return an empty array if there are no matches", function(done) {
            store.getJungleUsersFromMatrixId("nothing").done(function(res) {
                expect(res.length).toEqual(0);
                done();
            });
        });

        it("should return a list of users for multiple matches", function(done) {
            store.getJungleUsersFromMatrixId("@a:bar").done(function(res) {
                expect(res.length).toEqual(3);
                res.forEach(function(usr) {
                    expect(
                        ["a_1", "a_2", "a_3"].indexOf(usr.getId())
                    ).not.toEqual(-1);
                })
                done();
            });
        });

        it("should return a single element list for a single match", function(done) {
            store.getJungleUsersFromMatrixId("@b:bar").done(function(res) {
                expect(res.length).toEqual(1);
                expect(res[0].getId()).toEqual("b_1");
                done();
            });
        });

        describe("getJungleLinks", function() {
            it("should return a single element list for a single match",
            function(done) {
                store.getJungleLinks("@b:bar").done(function(res) {
                    expect(res.length).toEqual(1);
                    expect(res[0]).toEqual("b_1");
                    done();
                });
            });
        });
    });
});