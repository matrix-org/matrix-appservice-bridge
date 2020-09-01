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
    async function(done) {
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
        async function() {
            var userId = "@foo:bar";
            var user = new MatrixUser(userId);
            user.setDisplayName("Foo");
            const userFromStore = await store.setMatrixUser(user).then(function() {
                return store.getMatrixUser(userId);
            });
            expect(userFromStore.getId()).toEqual(userId);
            expect(userFromStore.getDisplayName()).toEqual("Foo");
        });
    });

    describe("setRemoteUser", function() {
        it("should be able to store a Remote user, retrievable again via getRemoteUser",
        async function() {
            var remoteId = "some_unique_id";
            var user = new RemoteUser(remoteId);
            const userFromStore = await store.setRemoteUser(user).then(function() {
                return store.getRemoteUser(remoteId);
            });
            expect(userFromStore.getId()).toEqual(remoteId);
        });

        it("should fully persist all types of primitive data", async function() {
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
            const userFromStore = await store.setRemoteUser(user).then(function() {
                return store.getRemoteUser(remoteId);
            });
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
        });

        it("should not persist functions", async function() {
            var remoteId = "some_unique_id";
            var user = new RemoteUser(remoteId);
            user.set("fn", function(foo) {
                return 42;
            });
            const userFromStore = await store.setRemoteUser(user).then(function() {
                return store.getRemoteUser(remoteId);
            });
            expect(userFromStore.getId()).toEqual(remoteId);
            expect(userFromStore.get("fn")).toBeUndefined();
        });
    });

    describe("getByRemoteData", function() {
        var remoteId = "some_unique_id";

        beforeEach(async function() {
            const user = new RemoteUser(remoteId);
            user.set("topLevel", 7);
            user.set("nested", {
                foo: "bar",
                baz: {
                    buzz: true
                }
            });
            await store.setRemoteUser(user);
        });

        it("should be able to retrieve via top level keys", async function() {
            const users = await store.getByRemoteData({
                topLevel: 7
            });
            expect(users.length).toEqual(1);
            const u = users[0];
            if (!u) {
                return;
            }
            expect(u.getId()).toEqual(remoteId);
        });

        it("should be able to retrieve via nested keys", async function() {
            const users = await store.getByRemoteData({
                "nested.baz.buzz": true
            });
            expect(users.length).toEqual(1);
            const u = users[0];
            if (!u) {
                return;
            }
            expect(u.getId()).toEqual(remoteId);
        });

        it("should be able to use basic NoSQL $commands", async function() {
            const users = await store.getByRemoteData({
                topLevel: {
                    $gt: 3 // greater than 3
                }
            });
            expect(users.length).toEqual(1);
            const u = users[0];
            if (!u) {
                return;
            }
            expect(u.getId()).toEqual(remoteId);
        });

        it("should throw if the data query isn't an object", function() {
            expect(function() {
                store.getByRemoteData("nested.key");
            }).toThrow();
        });
    });

    describe("linkUsers", function() {
        it("should link a matrix and remote ID which can be retrieved via getXFromY",
        async function() {
            const mx = new MatrixUser("@foo:bar");
            const jng = new RemoteUser("remote.id");
            const results = await store.linkUsers(mx, jng).then(function() {
                return store.getMatrixUsersFromRemoteId("remote.id");
            });
            expect(results.length).toEqual(1);
        });
    });

    describe("unlinkUsers", function() {
        it("should remove a previously linked matrix and remote user",
        async function() {
            var mx = new MatrixUser("@foo:bar");
            var jng = new RemoteUser("remote.id");
            await store.linkUsers(mx, jng).then(function() {
                return store.unlinkUsers(mx, jng);
            });
            const results = await store.getMatrixUsersFromRemoteId("remote.id");
            expect(results.length).toEqual(0);
        });

        it("should no-op if the link doesn't exist", async function() {
            var mx = new MatrixUser("@foo:bar");
            var jng = new RemoteUser("remote.id");
            await store.unlinkUsers(mx, jng);
            const results = await store.getMatrixUsersFromRemoteId("remote.id");
            expect(results.length).toEqual(0);
        });
    });

    describe("getByMatrixLocalpart", function() {
        it("should be able to get a stored matrix user by the user localpart",
        async function() {
            const mx = new MatrixUser("@foo:bar");
            await store.setMatrixUser(mx);
            const m = await store.getByMatrixLocalpart("foo");
            expect(m.getId()).toEqual("@foo:bar");
        });
    });

    describe("getMatrixUsersFromRemoteId", function() {

        beforeEach(async function() {
            // @a:bar --- a_1        @b:bar ----- b_1   @c:bar ---- c_1
            //                      @bb:bar _ /              \_____ c_2
            //                     @bbb:bar _/

            await store.linkUsers(new MatrixUser("@a:bar"), new RemoteUser("a_1")).then(
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
            });
        });


        it("should return an empty array if there are no matches", async function() {
            const res = await store.getMatrixUsersFromRemoteId("nothing");
            expect(res.length).toEqual(0);
        });

        it("should return a list of users for multiple matches", async function() {
            const res = await store.getMatrixUsersFromRemoteId("b_1");
            expect(res.length).toEqual(3);
            res.forEach(function(usr) {
                expect(
                    ["@b:bar", "@bb:bar", "@bbb:bar"].indexOf(usr.getId())
                ).not.toEqual(-1);
            })
        });

        it("should return a single element list for a single match", async function() {
            const res = await store.getMatrixUsersFromRemoteId("a_1");
            expect(res.length).toEqual(1);
            expect(res[0].getId()).toEqual("@a:bar");
        });

        describe("getMatrixLinks", function() {
            it("should return a single element list for a single match",
            async function() {
                const res = await store.getMatrixLinks("a_1");
                expect(res.length).toEqual(1);
                expect(res[0]).toEqual("@a:bar");
            });
        });
    });

    describe("getRemoteUsersFromMatrixId", function() {

        beforeEach(async function() {
            // @a:bar --- a_1        @b:bar ----- b_1
            //         \_ a_2
            //         \_ a_3

            await store.linkUsers(new MatrixUser("@a:bar"), new RemoteUser("a_1")).then(
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
            });
        });

        it("should return an empty array if there are no matches", async function() {
            const res = await store.getRemoteUsersFromMatrixId("nothing");
            expect(res.length).toEqual(0);
            
        });

        it("should return a list of users for multiple matches", async function() {
            const res = await store.getRemoteUsersFromMatrixId("@a:bar");
            expect(res.length).toEqual(3);
            res.forEach(function(usr) {
                expect(
                    ["a_1", "a_2", "a_3"].indexOf(usr.getId())
                ).not.toEqual(-1);
            })
        });

        it("should return a single element list for a single match", async function() {
            const res = await store.getRemoteUsersFromMatrixId("@b:bar");
            expect(res.length).toEqual(1);
            expect(res[0].getId()).toEqual("b_1");
        });

        describe("getRemoteLinks", function() {
            it("should return a single element list for a single match",
            async function() {
                const res = await store.getRemoteLinks("@b:bar");
                expect(res.length).toEqual(1);
                expect(res[0]).toEqual("b_1");
            });
        });
    });
});
