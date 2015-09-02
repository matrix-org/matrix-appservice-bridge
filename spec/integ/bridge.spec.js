"use strict";
var Promise = require("bluebird");
var Datastore = require("nedb");
var fs = require("fs");
var log = require("../log");

var HS_URL = "http://example.com";
var HS_DOMAIN = "example.com";
var BOT_LOCALPART = "the_bridge";

var TEST_USER_DB_PATH = __dirname + "/test-users.db";
var TEST_ROOM_DB_PATH = __dirname + "/test-rooms.db";
var UserBridgeStore = require("../..").UserBridgeStore;
var RoomBridgeStore = require("../..").RoomBridgeStore;
var MatrixUser = require("../..").MatrixUser;
var RemoteUser = require("../..").RemoteUser;
var Bridge = require("../..").Bridge;

describe("Bridge", function() {
    var bridge, bridgeCtrl, appService, clientFactory, appServiceRegistration;
    var roomStore, userStore, clients;

    beforeEach(
    /** @this */
    function(done) {
        log.beforeEach(this);
        // Setup mock client factory to avoid making real outbound HTTP conns
        clients = {};
        clientFactory = jasmine.createSpyObj("ClientFactory", [
            "setLogFunction", "getClientAs", "configure"
        ]);
        clientFactory.getClientAs.andCallFake(function(uid, req) {
            return clients[
                (uid ? uid : "bot") + (req ? req.getId() : "")];
        });
        clients["bot"] = mkMockMatrixClient(
            "@" + BOT_LOCALPART + ":" + HS_DOMAIN
        );

        // Setup mock AppService to avoid listening on a real port
        appService = jasmine.createSpyObj("AppService", [
            "onAliasQuery", "onUserQuery", "listen", "on"
        ]);
        appService._events = {};
        appService.on.andCallFake(function(name, fn) {
            if (!appService._events[name]) {
                appService._events[name] = [];
            }
            appService._events[name].push(fn);
        });
        appService.emit = function(name, obj) {
            var list = appService._events[name] || [];
            list.forEach(function(fn) {
                fn(obj);
            });
        };
        bridgeCtrl = jasmine.createSpyObj("controller", [
            "onEvent", "onAliasQuery", "onUserQuery"
        ]);
        appServiceRegistration = jasmine.createSpyObj("AppServiceRegistration", [
            "getOutput", "isUserMatch", "isAliasMatch", "isRoomMatch",
            "getHomeserverToken"
        ]);
        appServiceRegistration.getHomeserverToken.andReturn("h5_t0k3n");
        appServiceRegistration.getOutput.andReturn({
            hs_token: "h5_t0k3n",
            as_token: "a5_t0k3n",
            url: "http://app-service-url",
            sender_localpart: BOT_LOCALPART,
            namespaces: {
                users: [{
                    exclusive: true,
                    regex: "@virtual_.*"
                }],
                aliases: [{
                    exclusive: true,
                    regex: "#virtual_.*"
                }]
            }
        });

        function loadDatabase(path, Cls) {
            var defer = Promise.defer();
            var db = new Datastore({
                filename: path,
                autoload: true,
                onload: function(err) {
                    if (err) {
                        defer.reject(err);
                        return;
                    }
                    defer.resolve(new Cls(db));
                }
            });
            return defer.promise;
        }

        Promise.all([
            loadDatabase(TEST_USER_DB_PATH, UserBridgeStore),
            loadDatabase(TEST_ROOM_DB_PATH, RoomBridgeStore)
        ]).spread(function(userDb, roomDb) {
            userStore = userDb;
            roomStore = roomDb;
            bridge = new Bridge({
                homeserverUrl: HS_URL,
                domain: HS_DOMAIN,
                registration: appServiceRegistration,
                userStore: userDb,
                roomStore: roomDb,
                controller: bridgeCtrl,
                clientFactory: clientFactory
            });
            done();
        });
    });

    afterEach(function() {
        try {
            fs.unlinkSync(TEST_USER_DB_PATH);
        }
        catch(e) {
            // do nothing
        }
        try {
            fs.unlinkSync(TEST_ROOM_DB_PATH);
        }
        catch(e) {
            // do nothing
        }
    });

    describe("onUserQuery", function() {
        it("should invoke the user-supplied onUserQuery function with the right args",
        function() {

        });

        it("should not provision a user if null is returned from the function",
        function() {

        });

        it("should provision the user from the return object", function() {

        });

        it("should store the new matrix user", function() {

        });

        it("should store and link the new matrix user if a remote user was supplied",
        function() {

        });
    });

    describe("onAliasQuery", function() {
        it("should invoke the user-supplied onAliasQuery function with the right args",
        function() {

        });

        it("should not provision a room if null is returned from the function",
        function() {

        });

        it("should provision the room from the return object", function() {

        });

        it("should store the new matrix room", function() {

        });

        it("should store and link the new matrix room if a remote room was supplied",
        function() {

        });
    });

    describe("onEvent", function() {
        it("should suppress the event if it is an echo and suppressEcho=true",
        function() {

        });

        it("should invoke the user-supplied onEvent function with the right args",
        function() {

        });

        it("should include remote senders in the context if applicable", function() {

        });

        it("should include remote targets in the context if applicable", function() {

        });

        it("should include remote rooms in the context if applicable", function() {

        });

        it("should update cached Intents", function() {

        });
    });

    describe("run", function() {
        it("should emit a 'run' event with (port, config)", function(done) {
            var testConfig = {
                foo: "bar"
            };
            bridge.on("run", function(port, config) {
                expect(port).toEqual(101);
                expect(config).toEqual(testConfig);
                done();
            })
            bridge.run(101, testConfig, appService);
        });

        it("should invoke listen(port) on the AppService instance", function() {
            bridge.run(101, {}, appService);
            expect(appService.listen).toHaveBeenCalledWith(101);
        });
    });

    describe("getters", function() {
        it("should be able to getRoomStore", function() {
            expect(bridge.getRoomStore()).toEqual(roomStore);
        });

        it("should be able to getUserStore", function() {
            expect(bridge.getUserStore()).toEqual(userStore);
        });

        it("should be able to getRequestFactory", function() {
            expect(bridge.getRequestFactory()).toBeDefined();
        });

        it("should be able to getBot", function() {
            expect(bridge.getBot()).toBeDefined();
        });
    });

    describe("getIntent", function() {
        it("should return the same intent on multiple invokations", function() {
            var intent = bridge.getIntent("@foo:bar");
            intent._test = 42; // sentinel
            var intent2 = bridge.getIntent("@foo:bar");
            expect(intent).toEqual(intent2);
        });

        it("should keep the Intent up-to-date with incoming events", function(done) {
            var client = mkMockMatrixClient("@foo:bar");
            client.joinRoom.andReturn(Promise.resolve({})); // shouldn't be called
            clients["@foo:bar"] = client;

            var intent = bridge.getIntent("@foo:bar");
            var joinEvent = {
                content: {
                    membership: "join"
                },
                state_key: "@foo:bar",
                user_id: "@foo:bar",
                room_id: "!flibble:bar",
                type: "m.room.member"
            };
            bridge.run(101, {}, appService);
            appService.emit("event", joinEvent);
            intent.join("!flibble:bar").done(function() {
                expect(client.joinRoom).not.toHaveBeenCalled();
                done();
            });
        });

        it("should scope Intents to a request if provided", function() {
            var intent = bridge.getIntent("@foo:bar");
            intent._test = 42; // sentinel
            var intent2 = bridge.getIntent("@foo:bar", {
                getId: function() { return "request id here"; }
            });
            expect(intent2).toBeDefined();
            expect(intent).not.toEqual(intent2);
        });
    });

    describe("provisionUser", function() {
        it("should provision a user with the specified user ID", function(done) {
            var mxUser = new MatrixUser("@foo:bar");
            var provisionedUser = {};
            var botClient = clients["bot"];
            botClient.register.andReturn(Promise.resolve({}));
            bridge.provisionUser(mxUser, provisionedUser).then(function() {
                expect(botClient.register).toHaveBeenCalledWith(mxUser.localpart);
                // should also be persisted in storage
                return bridge.getUserStore().getMatrixUser("@foo:bar");
            }).done(function(usr) {
                expect(usr).toBeDefined();
                expect(usr.getId()).toEqual("@foo:bar");
                done();
            });
        });

        it("should set the display name if one was provided", function(done) {
            var mxUser = new MatrixUser("@foo:bar");
            var provisionedUser = {
                name: "Foo Bar"
            };
            var botClient = clients["bot"];
            botClient.register.andReturn(Promise.resolve({}));
            var client = mkMockMatrixClient("@foo:bar");
            client.setDisplayName.andReturn(Promise.resolve({}));
            clients["@foo:bar"] = client;
            bridge.provisionUser(mxUser, provisionedUser).done(function() {
                expect(botClient.register).toHaveBeenCalledWith(mxUser.localpart);
                expect(client.setDisplayName).toHaveBeenCalledWith("Foo Bar");
                done();
            });
        });

        it("should set the avatar URL if one was provided", function(done) {
            var mxUser = new MatrixUser("@foo:bar");
            var provisionedUser = {
                url: "http://avatar.jpg"
            };
            var botClient = clients["bot"];
            botClient.register.andReturn(Promise.resolve({}));
            var client = mkMockMatrixClient("@foo:bar");
            client.setAvatarUrl.andReturn(Promise.resolve({}));
            clients["@foo:bar"] = client;
            bridge.provisionUser(mxUser, provisionedUser).done(function() {
                expect(botClient.register).toHaveBeenCalledWith(mxUser.localpart);
                expect(client.setAvatarUrl).toHaveBeenCalledWith("http://avatar.jpg");
                done();
            });
        });

        it("should link the user with a remote user if one was provided",
        function(done) {
            var mxUser = new MatrixUser("@foo:bar");
            var provisionedUser = {
                user: new RemoteUser("__remote__")
            };
            var botClient = clients["bot"];
            botClient.register.andReturn(Promise.resolve({}));
            var client = mkMockMatrixClient("@foo:bar");
            clients["@foo:bar"] = client;
            bridge.provisionUser(mxUser, provisionedUser).then(function() {
                expect(botClient.register).toHaveBeenCalledWith(mxUser.localpart);
                return bridge.getUserStore().getRemoteUsersFromMatrixId("@foo:bar");
            }).done(function(users) {
                expect(users.length).toEqual(1);
                if (users.length > 0) {
                    expect(users[0].getId()).toEqual("__remote__");
                }
                done();
            });
        });

        it("should fail if the HTTP registration fails", function(done) {
            var mxUser = new MatrixUser("@foo:bar");
            var provisionedUser = {};
            var botClient = clients["bot"];
            botClient.register.andReturn(Promise.reject({
                errcode: "M_FORBIDDEN"
            }));
            bridge.provisionUser(mxUser, provisionedUser).catch(function() {
                expect(botClient.register).toHaveBeenCalledWith(mxUser.localpart);
                done();
            });
        });
    });
});

function mkMockMatrixClient(uid) {
    var client = jasmine.createSpyObj(
        "MatrixClient", [
            "register", "joinRoom", "credentials", "createRoom", "setDisplayName",
            "setAvatarUrl"
        ]
    );
    client.credentials.userId = uid;
    return client;
}
