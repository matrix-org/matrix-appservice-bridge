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
var MatrixRoom = require("../..").MatrixRoom;
var RemoteRoom = require("../..").RemoteRoom;
var AppServiceRegistration = require("matrix-appservice").AppServiceRegistration;
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
        clientFactory.getClientAs.and.callFake(function(uid, req) {
            return clients[
                (uid ? uid : "bot") + (req ? req.getId() : "")] || {uid};
        });
        clients["bot"] = mkMockMatrixClient(
            "@" + BOT_LOCALPART + ":" + HS_DOMAIN
        );

        // Setup mock AppService to avoid listening on a real port
        appService = jasmine.createSpyObj("AppService", [
            "onAliasQuery", "onUserQuery", "listen", "on"
        ]);
        appService._events = {};
        appService.on.and.callFake(function(name, fn) {
            if (!appService._events[name]) {
                appService._events[name] = [];
            }
            appService._events[name].push(fn);
        });
        appService.emit = function(name, obj) {
            var list = appService._events[name] || [];
            var promises = list.map(function(fn) {
                return fn(obj);
            });
            return Promise.all(promises);
        };
        bridgeCtrl = jasmine.createSpyObj("controller", [
            "onEvent", "onAliasQuery", "onUserQuery"
        ]);
        appServiceRegistration = AppServiceRegistration.fromObject({
            id: "an_id",
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
        }).done();
    });

    afterEach(function() {
        try {
            fs.unlinkSync(TEST_USER_DB_PATH);
        }
        catch (e) {
            // do nothing
        }
        try {
            fs.unlinkSync(TEST_ROOM_DB_PATH);
        }
        catch (e) {
            // do nothing
        }
    });

    describe("onUserQuery", function() {
        it("should invoke the user-supplied onUserQuery function with the right args",
        function(done) {
            bridge.run(101, {}, appService);
            appService.onUserQuery("@alice:bar").catch(function() {}).finally(
            function() {
                expect(bridgeCtrl.onUserQuery).toHaveBeenCalled();
                var call = bridgeCtrl.onUserQuery.calls.argsFor(0);
                var mxUser = call[0];
                expect(mxUser.getId()).toEqual("@alice:bar");
                done();
            });
        });

        it("should not provision a user if null is returned from the function",
        function(done) {
            bridgeCtrl.onUserQuery.and.returnValue(null);
            bridge.run(101, {}, appService);
            appService.onUserQuery("@alice:bar").catch(function() {}).finally(function() {
                expect(clients["bot"].register).not.toHaveBeenCalled();
                done();
            });
        });

        it("should provision the user from the return object", function(done) {
            bridgeCtrl.onUserQuery.and.returnValue({});
            clients["bot"].register.and.returnValue(Promise.resolve({}));
            bridge.run(101, {}, appService);
            appService.onUserQuery("@alice:bar").done(function() {
                expect(clients["bot"].register).toHaveBeenCalledWith("alice");
                done();
            });
        });
    });

    describe("onAliasQuery", function() {
        it("should invoke the user-supplied onAliasQuery function with the right args",
        function(done) {
            bridge.run(101, {}, appService);
            appService.onAliasQuery("#foo:bar").catch(function() {}).finally(function() {
                expect(bridgeCtrl.onAliasQuery).toHaveBeenCalledWith("#foo:bar", "foo");
                done();
            });
        });

        it("should not provision a room if null is returned from the function",
        function(done) {
            bridgeCtrl.onAliasQuery.and.returnValue(null);
            bridge.run(101, {}, appService);
            appService.onAliasQuery("#foo:bar").catch(function() {
                expect(clients["bot"].createRoom).not.toHaveBeenCalled();
                done();
            });
        });

        it("should provision the room from the returned object", function(done) {
            var provisionedRoom = {
                creationOpts: {
                    room_alias_name: "foo"
                }
            };
            clients["bot"].createRoom.and.returnValue({
                room_id: "!abc123:bar"
            });
            bridgeCtrl.onAliasQuery.and.returnValue(provisionedRoom);
            bridge.run(101, {}, appService);
            appService.onAliasQuery("#foo:bar").done(function() {
                expect(clients["bot"].createRoom).toHaveBeenCalledWith(
                    provisionedRoom.creationOpts
                );
                done();
            });
        });

        it("should store the new matrix room", function(done) {
            clients["bot"].createRoom.and.returnValue({
                room_id: "!abc123:bar"
            });
            bridgeCtrl.onAliasQuery.and.returnValue({
                creationOpts: {
                    room_alias_name: "foo"
                }
            });
            bridge.run(101, {}, appService);
            appService.onAliasQuery("#foo:bar").then(function() {
                return bridge.getRoomStore().getMatrixRoom("!abc123:bar");
            }).done(function(room) {
                expect(room).toBeDefined();
                if (!room) { done(); return; }
                expect(room.getId()).toEqual("!abc123:bar");
                done();
            });
        });

        it("should store and link the new matrix room if a remote room was supplied",
        function(done) {
            clients["bot"].createRoom.and.returnValue({
                room_id: "!abc123:bar"
            });
            bridgeCtrl.onAliasQuery.and.returnValue({
                creationOpts: {
                    room_alias_name: "foo"
                },
                remote: new RemoteRoom("__abc__")
            });
            bridge.run(101, {}, appService);
            appService.onAliasQuery("#foo:bar").then(function() {
                return bridge.getRoomStore().getLinkedRemoteRooms("!abc123:bar");
            }).done(function(rooms) {
                expect(rooms.length).toEqual(1);
                if (!rooms.length) { done(); return; }
                expect(rooms[0].getId()).toEqual("__abc__");
                done();
            });
        });
    });

    describe("onEvent", function() {
        it("should suppress the event if it is an echo and suppressEcho=true",
        function(done) {
            var event = {
                content: {
                    body: "oh noes!",
                    msgtype: "m.text"
                },
                user_id: "@virtual_foo:bar",
                room_id: "!flibble:bar",
                type: "m.room.message"
            };
            bridge.run(101, {}, appService).then(function() {
                return appService.emit("event", event);
            }).done(function() {
                expect(bridgeCtrl.onEvent).not.toHaveBeenCalled();
                done();
            });
        });

        it("should invoke the user-supplied onEvent function with the right args",
        function(done) {
            var event = {
                content: {
                    body: "oh noes!",
                    msgtype: "m.text"
                },
                user_id: "@foo:bar",
                room_id: "!flibble:bar",
                type: "m.room.message"
            };
            bridgeCtrl.onEvent.and.callFake(function(req) { req.resolve(); });

            bridge.run(101, {}, appService).then(function() {
                return appService.emit("event", event);
            }).done(function() {
                expect(bridgeCtrl.onEvent).toHaveBeenCalled();
                var call = bridgeCtrl.onEvent.calls.argsFor(0);
                var req = call[0];
                var ctx = call[1];
                expect(req.getData()).toEqual(event);
                expect(ctx.senders.matrix.getId()).toEqual("@foo:bar");
                expect(ctx.rooms.matrix.getId()).toEqual("!flibble:bar");
                done();
            });
        });

        it("should include remote senders in the context if applicable",
        function(done) {
            var event = {
                content: {
                    body: "oh noes!",
                    msgtype: "m.text"
                },
                user_id: "@alice:bar",
                room_id: "!flibble:bar",
                type: "m.room.message"
            };
            bridgeCtrl.onEvent.and.callFake(function(req) { req.resolve(); });

            bridge.run(101, {}, appService).then(function() {
                return bridge.getUserStore().linkUsers(
                    new MatrixUser("@alice:bar"),
                    new RemoteUser("__alice__")
                );
            }).then(function() {
                return appService.emit("event", event);
            }).done(function() {
                expect(bridgeCtrl.onEvent).toHaveBeenCalled();
                var call = bridgeCtrl.onEvent.calls.argsFor(0);
                var req = call[0];
                var ctx = call[1];
                expect(req.getData()).toEqual(event);
                expect(ctx.senders.remote.getId()).toEqual("__alice__");
                expect(ctx.senders.remotes.length).toEqual(1);
                done();
            });
        });

        it("should include remote targets in the context if applicable",
        function(done) {
            var event = {
                content: {
                    membership: "invite"
                },
                state_key: "@bob:bar",
                user_id: "@alice:bar",
                room_id: "!flibble:bar",
                type: "m.room.member"
            };
            bridgeCtrl.onEvent.and.callFake(function(req) { req.resolve(); });

            bridge.run(101, {}, appService).then(function() {
                return bridge.getUserStore().linkUsers(
                    new MatrixUser("@bob:bar"),
                    new RemoteUser("__bob__")
                );
            }).then(function() {
                return appService.emit("event", event);
            }).done(function() {
                expect(bridgeCtrl.onEvent).toHaveBeenCalled();
                var call = bridgeCtrl.onEvent.calls.argsFor(0);
                var req = call[0];
                var ctx = call[1];
                expect(req.getData()).toEqual(event);
                expect(ctx.targets.remote.getId()).toEqual("__bob__");
                expect(ctx.targets.remotes.length).toEqual(1);
                done();
            });
        });

        it("should include remote rooms in the context if applicable",
        function(done) {
            var event = {
                content: {
                    membership: "invite"
                },
                state_key: "@bob:bar",
                user_id: "@alice:bar",
                room_id: "!flibble:bar",
                type: "m.room.member"
            };
            bridgeCtrl.onEvent.and.callFake(function(req) { req.resolve(); });

            bridge.run(101, {}, appService).then(function() {
                return bridge.getRoomStore().linkRooms(
                    new MatrixRoom("!flibble:bar"),
                    new RemoteRoom("roomy")
                );
            }).then(function() {
                return appService.emit("event", event);
            }).done(function() {
                expect(bridgeCtrl.onEvent).toHaveBeenCalled();
                var call = bridgeCtrl.onEvent.calls.argsFor(0);
                var req = call[0];
                var ctx = call[1];
                expect(req.getData()).toEqual(event);
                expect(ctx.rooms.remote.getId()).toEqual("roomy");
                expect(ctx.rooms.remotes.length).toEqual(1);
                done();
            });
        });

        it("should omit the context if disableContext is true",
        function(done) {
            var event = {
                content: {
                    body: "oh noes!",
                    msgtype: "m.text"
                },
                user_id: "@alice:bar",
                room_id: "!flibble:bar",
                type: "m.room.message"
            };
            bridgeCtrl.onEvent.and.callFake(function(req) { req.resolve(); });

            bridge = new Bridge({
                homeserverUrl: HS_URL,
                domain: HS_DOMAIN,
                registration: appServiceRegistration,
                userStore: userStore,
                roomStore: roomStore,
                controller: bridgeCtrl,
                clientFactory: clientFactory,
                disableContext: true
            });

            bridge.run(101, {}, appService).then(function() {
                return appService.emit("event", event);
            }).done(function() {
                expect(bridgeCtrl.onEvent).toHaveBeenCalled();
                var call = bridgeCtrl.onEvent.calls.argsFor(0);
                var req = call[0];
                var ctx = call[1];
                expect(req.getData()).toEqual(event);
                expect(ctx).toBeNull();
                done();
            });
        });
    });

    describe("run", function() {
        it("should invoke listen(port) on the AppService instance", function() {
            bridge.run(101, {}, appService);
            expect(appService.listen).toHaveBeenCalledWith(101);
        });
    });

    describe("getters", function() {
        it("should be able to getRoomStore", function(done) {
            bridge.run(101, {}, appService).done(function() {
                expect(bridge.getRoomStore()).toEqual(roomStore);
                done();
            });
        });

        it("should be able to getUserStore", function(done) {
            bridge.run(101, {}, appService).done(function() {
                expect(bridge.getUserStore()).toEqual(userStore);
                done();
            });
        });

        it("should be able to getRequestFactory", function(done) {
            bridge.run(101, {}, appService).done(function() {
                expect(bridge.getRequestFactory()).toBeDefined();
                done();
            });
        });

        it("should be able to getBot", function(done) {
            bridge.run(101, {}, appService).done(function() {
                expect(bridge.getBot()).toBeDefined();
                done();
            });
        });
    });

    describe("getIntent", function() {
        // 2h which should be long enough to cull it
        var cullTimeMs = 1000 * 60 * 60 * 2;

        beforeEach(function(done) {
            jasmine.clock().install();
            jasmine.clock().mockDate();
            bridge.run(101, {}, appService).done(function() {
                done();
            });
        });

        afterEach(function() {
            jasmine.clock().uninstall();
        });

        it("should return the same intent on multiple invokations within the cull time",
        function() {
            var intent = bridge.getIntent("@foo:bar");
            // sentinel. If the same object is returned, this will be present.
            intent._test = 42;
            var intent2 = bridge.getIntent("@foo:bar");
            expect(intent).toEqual(intent2);
        });

        it(
        "should not return the same intent on multiple invokations outside the cull time",
        function() {
            var intent = bridge.getIntent("@foo:bar");
            // sentinel. If the same object is returned, this will be present.
            intent._test = 42;
            jasmine.clock().tick(cullTimeMs);
            var intent2 = bridge.getIntent("@foo:bar");
            expect(intent).not.toEqual(intent2);
        });

        it("should not cull intents which are accessed again via getIntent", function() {
            var intent = bridge.getIntent("@foo:bar");
            // sentinel. If the same object is returned, this will be present.
            intent._test = 42;

            // Call getIntent 1000 times evenly up to the cull time. If the cull time is
            // 2hrs, then this is called once every ~7.2s
            for (var i = 0; i < 1000; i ++) {
                jasmine.clock().tick(cullTimeMs/1000);
                bridge.getIntent("@foo:bar");
            }
            var intent2 = bridge.getIntent("@foo:bar");
            expect(intent).toEqual(intent2);
        });

        it("should keep the Intent up-to-date with incoming events", function(done) {
            var client = mkMockMatrixClient("@foo:bar");
            client.joinRoom.and.returnValue(Promise.resolve({})); // shouldn't be called
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
            appService.emit("event", joinEvent);
            intent.join("!flibble:bar").done(function() {
                expect(client.joinRoom).not.toHaveBeenCalled();
                done();
            });
        });

        it("should keep culled Intents up-to-date with incoming events", function(done) {
            // We tell the bridge that @foo:bar is joined to the room.
            // Therefore, we expect that intent.join() should NOT call the SDK's join
            // method. This should still be the case even if the Intent object is culled
            // and we try to join using a new intent, in addition to if we use the old
            // stale Intent.
            var client = mkMockMatrixClient("@foo:bar");
            client.joinRoom.and.returnValue(Promise.resolve({})); // shouldn't be called
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
            appService.emit("event", joinEvent);
            // wait the cull time then attempt the join, it shouldn't try to join.
            jasmine.clock().tick(cullTimeMs);

            intent.join("!flibble:bar").then(function() {
                expect(client.joinRoom).not.toHaveBeenCalled();
                // wait the cull time again and use a new intent, still shouldn't join.
                jasmine.clock().tick(cullTimeMs);
                return bridge.getIntent("@foo:bar").join("!flibble:bar");
            }).done(function() {
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

        it("should return an escaped userId",
        function() {
            const intent = bridge.getIntent("@foo£$&!£:bar");
            expect(intent.client.uid).toEqual("@foo=a3=24=26=21=a3:bar");
        });

        it("should not return an escaped userId if disabled",
        function() {
            bridge.opts.escapeUserIds = false;
            const intent = bridge.getIntent("@foo£$&!£:bar");
            expect(intent.client.uid).toEqual("@foo£$&!£:bar");
        });
    });

    describe("provisionUser", function() {

        beforeEach(function(done) {
            bridge.run(101, {}, appService).done(function() {
                done();
            });
        });

        it("should provision a user with the specified user ID", function(done) {
            var mxUser = new MatrixUser("@foo:bar");
            var provisionedUser = {};
            var botClient = clients["bot"];
            botClient.register.and.returnValue(Promise.resolve({}));
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
            botClient.register.and.returnValue(Promise.resolve({}));
            var client = mkMockMatrixClient("@foo:bar");
            client.setDisplayName.and.returnValue(Promise.resolve({}));
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
            botClient.register.and.returnValue(Promise.resolve({}));
            var client = mkMockMatrixClient("@foo:bar");
            client.setAvatarUrl.and.returnValue(Promise.resolve({}));
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
                remote: new RemoteUser("__remote__")
            };
            var botClient = clients["bot"];
            botClient.register.and.returnValue(Promise.resolve({}));
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
            botClient.register.and.returnValue(Promise.reject({
                errcode: "M_FORBIDDEN"
            }));
            bridge.provisionUser(mxUser, provisionedUser).catch(function() {
                expect(botClient.register).toHaveBeenCalledWith(mxUser.localpart);
                done();
            });
        });
    });

    describe("_onEvent", () => {
        it("should not upgrade a room if state_key is not defined", () => {
            bridge._roomUpgradeHandler = jasmine.createSpyObj("_roomUpgradeHandler", ["onTombstone"]);
            bridge._roomUpgradeHandler.onTombstone.and.returnValue(Promise.resolve({}));
            bridgeCtrl.onEvent.and.callFake(function(req) { req.resolve(); });
            bridge.opts.roomUpgradeOpts = { consumeEvent: true };
            return bridge.run(101, {}, appService).then(() => {
                return bridge._onEvent({
                    type: "m.room.tombstone",
                    state_key: undefined,
                    user_id: "@foo:bar",
                    sender: "@foo:bar",
                });
            }).then(() => {
                expect(bridge._roomUpgradeHandler.onTombstone).not.toHaveBeenCalled();
            });
        });

        it("should not upgrade a room if state_key is not === '' ", () => {
            bridge._roomUpgradeHandler = jasmine.createSpyObj("_roomUpgradeHandler", ["onTombstone"]);
            bridge._roomUpgradeHandler.onTombstone.and.returnValue(Promise.resolve({}));
            bridgeCtrl.onEvent.and.callFake(function(req) { req.resolve(); });
            bridge.opts.roomUpgradeOpts = { consumeEvent: true };
            return bridge.run(101, {}, appService).then(() => {
                return bridge._onEvent({
                    type: "m.room.tombstone",
                    state_key: "fooobar",
                    user_id: "@foo:bar",
                    sender: "@foo:bar",
                });
            }).then(() => {
                expect(bridge._roomUpgradeHandler.onTombstone).not.toHaveBeenCalled();
                return bridge._onEvent({
                    type: "m.room.tombstone",
                    state_key: 212345,
                    user_id: "@foo:bar",
                    sender: "@foo:bar",
                });
            }).then(() => {
                expect(bridge._roomUpgradeHandler.onTombstone).not.toHaveBeenCalled();
                return bridge._onEvent({
                    type: "m.room.tombstone",
                    state_key: null,
                    user_id: "@foo:bar",
                    sender: "@foo:bar",
                });
            }).then(() => {
                expect(bridge._roomUpgradeHandler.onTombstone).not.toHaveBeenCalled();
            });
        });

        it("should upgrade a room if state_key == '' is defined", () => {
            bridge._roomUpgradeHandler = jasmine.createSpyObj("_roomUpgradeHandler", ["onTombstone"]);
            bridge._roomUpgradeHandler.onTombstone.and.returnValue(Promise.resolve({}));
            bridgeCtrl.onEvent.and.callFake(function(req) { req.resolve(); });
            bridge.opts.roomUpgradeOpts = { consumeEvent: true };
            return bridge.run(101, {}, appService).then(() => {
                return bridge._onEvent({
                    type: "m.room.tombstone",
                    state_key: "",
                    user_id: "@foo:bar",
                    sender: "@foo:bar",
                });
            }).then(() => {
                expect(bridge._roomUpgradeHandler.onTombstone).toHaveBeenCalled();
            });
        });
    });
});

function mkMockMatrixClient(uid) {
    var client = jasmine.createSpyObj(
        "MatrixClient", [
            "register", "joinRoom", "credentials", "createRoom", "setDisplayName",
            "setAvatarUrl", "_http"
        ]
    );
    // Shim requests to authedRequestWithPrefix to register() if it is
    // directed at /register
    client._http.authedRequest = jasmine.createSpy("authedRequestWithPrefix");
    client._http.authedRequest.and.callFake(function(a, method, path, d, data) {
        if (method === "POST" && path === "/register") {
            return client.register(data.user);
        }
        return undefined;
    });
    client.credentials.userId = uid;
    return client;
}
