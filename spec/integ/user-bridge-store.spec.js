"use strict";
var Datastore = require("nedb");
var fs = require("fs");
var log = require("../log");

var UserBridgeStore = require("../..").UserBridgeStore;
var MatrixUser = require("../..").MatrixUser;
var RemoteUser = require("../..").RemoteUser;
var TEST_DB_PATH = __dirname + "/test.db";

describe("UserBridgeStore", function() {
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
                store = new UserBridgeStore(db);
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

    describe("setMatrixUser", function() {
        it("should be able to store a Matrix user, retrievable again via getMatrixUser",
        function(done) {
            var userId = "@foo:bar";
            var user = new MatrixUser(userId);
            user.setDisplayName("Foo");
            store.setMatrixUser(user).then(function() {
                return store.getMatrixUser(userId);
            }).done(function(userFromStore) {
                expect(userFromStore.getId()).toEqual(userId);
                expect(userFromStore.getDisplayName()).toEqual("Foo");
                done();
            });
        });
    });

    describe("setRemoteUser", function() {
        it("should be able to store a Remote user, retrievable again via getRemoteUser",
        function(done) {
            var remoteId = "some_unique_id";
            var user = new RemoteUser(remoteId);
            store.setRemoteUser(user).then(function() {
                return store.getRemoteUser(remoteId);
            }).done(function(userFromStore) {
                expect(userFromStore.getId()).toEqual(remoteId);
                done();
            });
        });

        it("should fully persist all types of primitive data", function(done) {
            var remoteId = "some_unique_id";
            var user = new RemoteUser(remoteId);
            user.set("int", 42);
            user.set("str", "the answer");
            user.set("bool", true);
            user.set("obj", {
                foo: "bar",
                baz: {
                    buzz: true
                }
            });
            store.setRemoteUser(user).then(function() {
                return store.getRemoteUser(remoteId);
            }).done(function(userFromStore) {
                expect(userFromStore.getId()).toEqual(remoteId);
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
            var remoteId = "some_unique_id";
            var user = new RemoteUser(remoteId);
            user.set("fn", function(foo) {
                return 42;
            });
            store.setRemoteUser(user).then(function() {
                return store.getRemoteUser(remoteId);
            }).done(function(userFromStore) {
                expect(userFromStore.getId()).toEqual(remoteId);
                expect(userFromStore.get("fn")).toBeUndefined();
                done();
            });
        });
    });

    describe("getByRemoteData", function() {
        var remoteId = "some_unique_id";

        beforeEach(function(done) {
            var user = new RemoteUser(remoteId);
            user.set("topLevel", 7);
            user.set("nested", {
                foo: "bar",
                baz: {
                    buzz: true
                }
            });
            store.setRemoteUser(user).done(function() {
                done();
            });
        });

        it("should be able to retrieve via top level keys", function(done) {
            store.getByRemoteData({
                topLevel: 7
            }).done(function(users) {
                expect(users.length).toEqual(1);
                var u = users[0];
                if (!u) {
                    done();
                    return;
                }
                expect(u.getId()).toEqual(remoteId);
                done();
            });
        });

        it("should be able to retrieve via nested keys", function(done) {
            store.getByRemoteData({
                "nested.baz.buzz": true
            }).done(function(users) {
                expect(users.length).toEqual(1);
                var u = users[0];
                if (!u) {
                    done();
                    return;
                }
                expect(u.getId()).toEqual(remoteId);
                done();
            });
        });

        it("should be able to use basic NoSQL $commands", function(done) {
            store.getByRemoteData({
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
                expect(u.getId()).toEqual(remoteId);
                done();
            });
        });

        it("should throw if the data query isn't an object", function() {
            expect(function() {
                store.getByRemoteData("nested.key");
            }).toThrow();
        });
    });

    describe("linkUsers", function() {
        it("should link a matrix and remote ID which can be retrieved via getXFromY",
        function(done) {
            var mx = new MatrixUser("@foo:bar");
            var jng = new RemoteUser("remote.id");
            store.linkUsers(mx, jng).then(function() {
                return store.getMatrixUsersFromRemoteId("remote.id");
            }).done(function(results) {
                expect(results.length).toEqual(1);
                done();
            });
        });
    });

    describe("unlinkUsers", function() {
        it("should remove a previously linked matrix and remote user",
        function(done) {
            var mx = new MatrixUser("@foo:bar");
            var jng = new RemoteUser("remote.id");
            store.linkUsers(mx, jng).then(function() {
                return store.unlinkUsers(mx, jng);
            }).then(function() {
                return store.getMatrixUsersFromRemoteId("remote.id");
            }).done(function(results) {
                expect(results.length).toEqual(0);
                done();
            });
        });

        it("should no-op if the link doesn't exist", function(done) {
            var mx = new MatrixUser("@foo:bar");
            var jng = new RemoteUser("remote.id");
            store.unlinkUsers(mx, jng).then(function() {
                return store.getMatrixUsersFromRemoteId("remote.id");
            }).done(function(results) {
                expect(results.length).toEqual(0);
                done();
            });
        });
    });

    describe("getByMatrixLocalpart", function() {
        it("should be able to get a stored matrix user by the user localpart",
        function(done) {
            var mx = new MatrixUser("@foo:bar");
            store.setMatrixUser(mx).then(function() {
                return store.getByMatrixLocalpart("foo");
            }).done(function(m) {
                expect(m.getId()).toEqual("@foo:bar");
                done();
            });
        });
    });

    describe("getMatrixUsersFromRemoteId", function() {

        beforeEach(function(done) {
            // @a:bar --- a_1        @b:bar ----- b_1   @c:bar ---- c_1
            //                      @bb:bar _ /              \_____ c_2
            //                     @bbb:bar _/

            store.linkUsers(new MatrixUser("@a:bar"), new RemoteUser("a_1")).then(
            function() {
                return store.linkUsers(
                    new MatrixUser("@b:bar"), new RemoteUser("b_1")
                );
            }).then(function() {
                return store.linkUsers(
                    new MatrixUser("@bb:bar"), new RemoteUser("b_1")
                );
            }).then(function() {
                return store.linkUsers(
                    new MatrixUser("@bbb:bar"), new RemoteUser("b_1")
                );
            }).then(function() {
                return store.linkUsers(
                    new MatrixUser("@c:bar"), new RemoteUser("c_1")
                );
            }).then(function() {
                return store.linkUsers(
                    new MatrixUser("@c:bar"), new RemoteUser("c_2")
                );
            }).done(function() {
                done();
            });
        });


        it("should return an empty array if there are no matches", function(done) {
            store.getMatrixUsersFromRemoteId("nothing").done(function(res) {
                expect(res.length).toEqual(0);
                done();
            });
        });

        it("should return a list of users for multiple matches", function(done) {
            store.getMatrixUsersFromRemoteId("b_1").done(function(res) {
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
            store.getMatrixUsersFromRemoteId("a_1").done(function(res) {
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

    describe("getRemoteUsersFromMatrixId", function() {

        beforeEach(function(done) {
            // @a:bar --- a_1        @b:bar ----- b_1
            //         \_ a_2
            //         \_ a_3

            store.linkUsers(new MatrixUser("@a:bar"), new RemoteUser("a_1")).then(
            function() {
                return store.linkUsers(
                    new MatrixUser("@a:bar"), new RemoteUser("a_2")
                );
            }).then(function() {
                return store.linkUsers(
                    new MatrixUser("@a:bar"), new RemoteUser("a_3")
                );
            }).then(function() {
                return store.linkUsers(
                    new MatrixUser("@b:bar"), new RemoteUser("b_1")
                );
            }).done(function() {
                done();
            });
        });

        it("should return an empty array if there are no matches", function(done) {
            store.getRemoteUsersFromMatrixId("nothing").done(function(res) {
                expect(res.length).toEqual(0);
                done();
            });
        });

        it("should return a list of users for multiple matches", function(done) {
            store.getRemoteUsersFromMatrixId("@a:bar").done(function(res) {
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
            store.getRemoteUsersFromMatrixId("@b:bar").done(function(res) {
                expect(res.length).toEqual(1);
                expect(res[0].getId()).toEqual("b_1");
                done();
            });
        });

        describe("getRemoteLinks", function() {
            it("should return a single element list for a single match",
            function(done) {
                store.getRemoteLinks("@b:bar").done(function(res) {
                    expect(res.length).toEqual(1);
                    expect(res[0]).toEqual("b_1");
                    done();
                });
            });
        });
    });
});
