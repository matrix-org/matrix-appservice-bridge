"use strict";
const Datastore = require("nedb");
const fs = require("fs");
const log = require("../log");

const HS_URL = "http://example.com";
const HS_DOMAIN = "example.com";
const BOT_LOCALPART = "the_bridge";
const BOT_USER_ID = `@${BOT_LOCALPART}:${HS_DOMAIN}`;

const TEST_USER_DB_PATH = __dirname + "/test-users.db";
const TEST_ROOM_DB_PATH = __dirname + "/test-rooms.db";
const TEST_EVENT_DB_PATH = __dirname + "/test-events.db";
const UserBridgeStore = require("../..").UserBridgeStore;
const RoomBridgeStore = require("../..").RoomBridgeStore;
const EventBridgeStore = require("../..").EventBridgeStore;
const MatrixUser = require("../..").MatrixUser;
const RemoteUser = require("../..").RemoteUser;
const MatrixRoom = require("../..").MatrixRoom;
const RemoteRoom = require("../..").RemoteRoom;
const AppServiceRegistration = require("matrix-appservice").AppServiceRegistration;
const {Bridge, BRIDGE_PING_EVENT_TYPE, BRIDGE_PING_TIMEOUT_MS} = require("../..");

const deferPromise = require("../../lib/utils/promiseutil").defer;

describe("Bridge", function() {
    var bridge, bridgeCtrl, appService, clientFactory, appServiceRegistration;
    var roomStore, userStore, eventStore, clients;

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
        appService.emit = (name, obj) => {
            const list = appService._events[name] || [];
            const promises = list.map((fn) => fn(obj));
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
            const defer = deferPromise();
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
            loadDatabase(TEST_ROOM_DB_PATH, RoomBridgeStore),
            loadDatabase(TEST_EVENT_DB_PATH, EventBridgeStore)
        ]).then(([userDb, roomDb, eventDb]) => {
            userStore = userDb;
            roomStore = roomDb;
            eventStore = eventDb;
            bridge = new Bridge({
                homeserverUrl: HS_URL,
                domain: HS_DOMAIN,
                registration: appServiceRegistration,
                userStore: userDb,
                roomStore: roomDb,
                eventStore: eventDb,
                controller: bridgeCtrl,
                clientFactory: clientFactory
            });
            return bridge.loadDatabases();
        }).then(() => {
            done();
        });
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
        try {
            fs.unlinkSync(TEST_EVENT_DB_PATH);
        }
        catch (e) {
            // do nothing
        }
    });

    describe("onUserQuery", function() {
        it("should invoke the user-supplied onUserQuery function with the right args", async() => {
            await bridge.run(101, {}, appService);
            try {
                await appService.onUserQuery("@alice:bar");
            }
            catch (error) {
                // do nothing
            }
            finally {
                expect(bridgeCtrl.onUserQuery).toHaveBeenCalled();
                var call = bridgeCtrl.onUserQuery.calls.argsFor(0);
                var mxUser = call[0];
                expect(mxUser.getId()).toEqual("@alice:bar");
            }
        });

        it("should not provision a user if null is returned from the function",
        async function(done) {
            bridgeCtrl.onUserQuery.and.returnValue(null);
            await bridge.run(101, {}, appService);
            appService.onUserQuery("@alice:bar").catch(function() {}).finally(function() {
                expect(clients["bot"].register).not.toHaveBeenCalled();
                done();
            });
        });

        it("should provision the user from the return object", async() => {
            bridgeCtrl.onUserQuery.and.returnValue({});
            clients["bot"].register.and.returnValue(Promise.resolve({}));
            await bridge.run(101, {}, appService);
            await appService.onUserQuery("@alice:bar");
            expect(clients["bot"].register).toHaveBeenCalledWith("alice");
        });
    });

    describe("onAliasQuery", function() {
        it("should invoke the user-supplied onAliasQuery function with the right args",
        async function() {
            await bridge.run(101, {}, appService);

            try {
                await appService.onAliasQuery("#foo:bar")
            }
            catch (err) {
                // no-op
            }

            expect(bridgeCtrl.onAliasQuery).toHaveBeenCalledWith("#foo:bar", "foo");
        });

        it("should not provision a room if null is returned from the function",
        async function() {
            bridgeCtrl.onAliasQuery.and.returnValue(null);
            await bridge.run(101, {}, appService);

            try {
                await appService.onAliasQuery("#foo:bar");
                fail(new Error('We expect `onAliasQuery` to fail and throw an error'))
            }
            catch (err) {
                expect(clients["bot"].createRoom).not.toHaveBeenCalled();
            }
        });

        it("should not create a room if roomId is returned from the function but should still store it",
        async function() {
            bridgeCtrl.onAliasQuery.and.returnValue({ roomId: "!abc123:bar" });
            await bridge.run(101, {}, appService);

            await appService.onAliasQuery("#foo:bar");

            expect(clients["bot"].createRoom).not.toHaveBeenCalled();

            const room = await bridge.getRoomStore().getMatrixRoom("!abc123:bar");
            expect(room).toBeDefined();
            expect(room.getId()).toEqual("!abc123:bar");
        });

    it("should provision the room from the returned object", async() => {
            const provisionedRoom = {
                creationOpts: {
                    room_alias_name: "foo",
                },
            };
            clients["bot"].createRoom.and.returnValue({
                room_id: "!abc123:bar",
            });
            bridgeCtrl.onAliasQuery.and.returnValue(provisionedRoom);
            await bridge.run(101, {}, appService);
            await appService.onAliasQuery("#foo:bar");
            expect(clients["bot"].createRoom).toHaveBeenCalledWith(
                provisionedRoom.creationOpts
            );
        });

        it("should store the new matrix room", async() => {
            clients["bot"].createRoom.and.returnValue({
                room_id: "!abc123:bar",
            });
            bridgeCtrl.onAliasQuery.and.returnValue({
                creationOpts: {
                    room_alias_name: "foo",
                },
            });
            await bridge.run(101, {}, appService);

            await appService.onAliasQuery("#foo:bar");

            const room = await bridge.getRoomStore().getMatrixRoom("!abc123:bar");
            expect(room).toBeDefined();
            expect(room.getId()).toEqual("!abc123:bar");
        });

        it("should store and link the new matrix room if a remote room was supplied", async() => {
            clients["bot"].createRoom.and.returnValue({
                room_id: "!abc123:bar"
            });
            bridgeCtrl.onAliasQuery.and.returnValue({
                creationOpts: {
                    room_alias_name: "foo",
                },
                remote: new RemoteRoom("__abc__")
            });
            await bridge.run(101, {}, appService);

            await appService.onAliasQuery("#foo:bar");

            const rooms = await bridge.getRoomStore().getLinkedRemoteRooms("!abc123:bar");
            expect(rooms.length).toEqual(1);
            expect(rooms[0].getId()).toEqual("__abc__");
        });
    });

    describe("pingAppserviceRoute", () => {
        it("should return successfully when the bridge receives it's own self ping", async () => {
            let sentEvent = false;
            await bridge.run(101, {}, appService);
            bridge.botIntent._ensureJoined = async () => true;
            bridge.botIntent._ensureHasPowerLevelFor = async () => true;
            bridge.botIntent.sendEvent = async () => {sentEvent = true};
            const event = {
                content: {
                    sentTs: 1000,
                },
                sender: BOT_USER_ID,
                room_id: "!abcdef:bar",
                type: BRIDGE_PING_EVENT_TYPE,
            };
            const result = bridge.pingAppserviceRoute(event.room_id);
            await appService.emit("event", event);
            expect(await result).toBeLessThan(BRIDGE_PING_TIMEOUT_MS);
            expect(sentEvent).toEqual(true);
        });
        it("should time out if the ping does not respond", async () => {
            let sentEvent = false;
            await bridge.run(101, {}, appService);
            bridge.botIntent._ensureJoined = async () => true;
            bridge.botIntent._ensureHasPowerLevelFor = async () => true;
            bridge.botIntent.sendEvent = async () => {sentEvent = true};
            const result = bridge.pingAppserviceRoute("!abcdef:bar", 100);
            expect(sentEvent).toEqual(true);
            try {
                await result;
                throw Error("Expected to throw");
            }
            catch (ex) {
                expect(ex.message).toEqual("Timeout waiting for ping event");
            }
        });
    });

    describe("onEvent", function() {
        it("should suppress the event if it is an echo and suppressEcho=true", async() => {
            var event = {
                content: {
                    body: "oh noes!",
                    msgtype: "m.text"
                },
                sender: "@virtual_foo:bar",
                room_id: "!flibble:bar",
                type: "m.room.message"
            };
            await bridge.run(101, {}, appService);
            await appService.emit("event", event);
            expect(bridgeCtrl.onEvent).not.toHaveBeenCalled();
        });

        describe('opts.eventValidation.validateEditSender', () => {
            async function setupBridge(eventValidation) {
                const bridge = new Bridge({
                    homeserverUrl: HS_URL,
                    domain: HS_DOMAIN,
                    registration: appServiceRegistration,
                    userStore: userStore,
                    roomStore: roomStore,
                    controller: bridgeCtrl,
                    clientFactory: clientFactory,
                    disableContext: true,
                    eventValidation
                });
                await bridge.run(101, {}, appService);

                return bridge;
            }

            function createMessageEditEvent(sender) {
                const event = {
                    content: {
                        body: ' * my message edit',
                        'm.new_content': { body: 'my message edit', msgtype: 'm.text' },
                        'm.relates_to': { 
                            event_id: '$ZrXenSQt4TbtHnMclrWNJdiP7SrRCSdl3tAYS81H2bs',
                            rel_type: 'm.replace' 
                        },
                    msgtype: 'm.text'
                    },
                    event_id: '$tagvjsXZqBOBWtHijq2qg0Un-uqVunrFLxiJyOIVGQ8',
                    room_id: '!dtJaPyDtsoOLTgJVmy:my.matrix.host',
                    sender,
                    type: 'm.room.message',
                };

                return event;
            }

            let botClient;
            beforeEach(async () => {
                botClient = clients["bot"];
                botClient.getJoinedRoomMembers.and.returnValue(Promise.resolve({
                    joined: {
                        [botClient.credentials.userId]: {
                            display_name: "bot"
                        }
                    }
                }));

                // Mock onEvent callback
                bridgeCtrl.onEvent.and.callFake(function(req) { req.resolve(); });
            });

            describe('when enabled', () => {
                beforeEach(async () => {
                    bridge = await setupBridge({
                        validateEditSender: {
                            allowEventOnLookupFail: false,
                        }
                    })
                });

                it("should suppress the event if the edit is coming from a different person than the original message", async() => {
                    const event = createMessageEditEvent('@root:my.matrix.host');

                    botClient.fetchRoomEvent.and.returnValue(Promise.resolve({
                        event_id: '$ZrXenSQt4TbtHnMclrWNJdiP7SrRCSdl3tAYS81H2bs',
                        // The original message has different sender than the edit event
                        sender: '@some-other-user:different.host',
                    }));

                    await appService.emit("event", event);
                    expect(bridgeCtrl.onEvent).not.toHaveBeenCalled();
                });

                it("should emit event when the edit sender matches the original message sender", async() => {
                    const event = createMessageEditEvent('@root:my.matrix.host');
                    
                    botClient.fetchRoomEvent.and.returnValue(Promise.resolve({
                        event_id: '$ZrXenSQt4TbtHnMclrWNJdiP7SrRCSdl3tAYS81H2bs',
                        // The original message sender is the same as the edit event
                        sender: '@root:my.matrix.host',
                    }));

                    await appService.emit("event", event);
                    expect(bridgeCtrl.onEvent).toHaveBeenCalled();
                });
            });

            it('allowEventOnLookupFail=true should still emit event when failed to fetch original event', async() => {
                const event = createMessageEditEvent('@root:my.matrix.host');

                bridge = await setupBridge({
                    validateEditSender: {
                        // Option of interest for this test is here!
                        allowEventOnLookupFail: true,
                    }
                })

                const botClient = clients["bot"];
                botClient.getJoinedRoomMembers.and.returnValue(Promise.resolve({
                    joined: {
                        [botClient.credentials.userId]: {
                            display_name: "bot"
                        }
                    }
                }));
                botClient.fetchRoomEvent.and.returnValue(Promise.reject(new Error('Some problem fetching original event')));

                await appService.emit("event", event);
                expect(bridgeCtrl.onEvent).toHaveBeenCalled();
            })

            describe('when disabled', () => {
                it("should emit event even when the edit sender does NOT match the original message sender", async() => {
                    const event = createMessageEditEvent('@root:my.matrix.host');
                    
                    bridge = await setupBridge(undefined)

                    botClient.fetchRoomEvent.and.returnValue(Promise.resolve({
                        event_id: '$ZrXenSQt4TbtHnMclrWNJdiP7SrRCSdl3tAYS81H2bs',
                        // The original message has different sender than the edit event
                        sender: '@some-other-user:different.host',
                    }));

                    await appService.emit("event", event);
                    expect(bridgeCtrl.onEvent).toHaveBeenCalled();
                });
            })
        });

        it("should invoke the user-supplied onEvent function with the right args",
        function(done) {
            var event = {
                content: {
                    body: "oh noes!",
                    msgtype: "m.text"
                },
                sender: "@foo:bar",
                room_id: "!flibble:bar",
                type: "m.room.message"
            };
            bridgeCtrl.onEvent.and.callFake(function(req) { req.resolve(); });

            bridge.run(101, {}, appService).then(function() {
                return appService.emit("event", event);
            }).then(function() {
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

        it("should include remote senders in the context if applicable", async() => {
            var event = {
                content: {
                    body: "oh noes!",
                    msgtype: "m.text"
                },
                sender: "@alice:bar",
                room_id: "!flibble:bar",
                type: "m.room.message"
            };
            bridgeCtrl.onEvent.and.callFake(function(req) { req.resolve(); });

            await bridge.run(101, {}, appService)
            await bridge.getUserStore().linkUsers(
                new MatrixUser("@alice:bar"),
                new RemoteUser("__alice__")
            );
            await appService.emit("event", event);
            expect(bridgeCtrl.onEvent).toHaveBeenCalled();
            var call = bridgeCtrl.onEvent.calls.argsFor(0);
            var req = call[0];
            var ctx = call[1];
            expect(req.getData()).toEqual(event);
            expect(ctx.senders.remote.getId()).toEqual("__alice__");
            expect(ctx.senders.remotes.length).toEqual(1);
        });

        it("should include remote targets in the context if applicable", async() => {
            var event = {
                content: {
                    membership: "invite"
                },
                state_key: "@bob:bar",
                sender: "@alice:bar",
                room_id: "!flibble:bar",
                type: "m.room.member"
            };
            bridgeCtrl.onEvent.and.callFake(function(req) { req.resolve(); });

            await bridge.run(101, {}, appService);
            await bridge.getUserStore().linkUsers(
                new MatrixUser("@bob:bar"),
                new RemoteUser("__bob__")
            );
            await appService.emit("event", event);
            expect(bridgeCtrl.onEvent).toHaveBeenCalled();
            var call = bridgeCtrl.onEvent.calls.argsFor(0);
            var req = call[0];
            var ctx = call[1];
            expect(req.getData()).toEqual(event);
            expect(ctx.targets.remote.getId()).toEqual("__bob__");
            expect(ctx.targets.remotes.length).toEqual(1);
        });

        it("should include remote rooms in the context if applicable",
        function(done) {
            var event = {
                content: {
                    membership: "invite"
                },
                state_key: "@bob:bar",
                sender: "@alice:bar",
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
            }).then(function() {
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

        it("should omit the context if disableContext is true", async() => {
            const event = {
                content: {
                    body: "oh noes!",
                    msgtype: "m.text"
                },
                sender: "@alice:bar",
                room_id: "!flibble:bar",
                type: "m.room.message"
            };
            bridgeCtrl.onEvent.and.callFake((req) => { req.resolve(); });

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

            await bridge.run(101, {}, appService);
            await appService.emit("event", event);
            expect(bridgeCtrl.onEvent).toHaveBeenCalled();
            var call = bridgeCtrl.onEvent.calls.argsFor(0);
            var req = call[0];
            var ctx = call[1];
            expect(req.getData()).toEqual(event);
            expect(ctx).toBeNull();
        });
    });

    describe("run", () => {
        it("should invoke listen(port) on the AppService instance", async() => {
            await bridge.run(101, {}, appService);
            expect(appService.listen).toHaveBeenCalledWith(101, "0.0.0.0", 10);
        });
        it("should invoke listen(port, hostname) on the AppService instance", async() => {
            await bridge.run(101, {}, appService, "foobar");
            expect(appService.listen).toHaveBeenCalledWith(101, "foobar", 10);
        });
    });

    describe("getters", function() {
        it("should be able to getRoomStore", async() => {
            await bridge.run(101, {}, appService);
            expect(bridge.getRoomStore()).toEqual(roomStore);
        });

        it("should be able to getUserStore", async() => {
            await bridge.run(101, {}, appService);
            expect(bridge.getUserStore()).toEqual(userStore);
        });

        it("should be able to getEventStore", async() => {
            await bridge.run(101, {}, appService);
            expect(bridge.getEventStore()).toEqual(eventStore);
        });

        it("should be able to getRequestFactory", async() => {
            await bridge.run(101, {}, appService);
            expect(bridge.getRequestFactory()).toBeDefined();
        });

        it("should be able to getBot", async() => {
            await bridge.run(101, {}, appService);
            expect(bridge.getBot()).toBeDefined();
        });
    });

    describe("getIntent", function() {
        // 2h which should be long enough to cull it
        var cullTimeMs = 1000 * 60 * 60 * 2;

        beforeEach(async() => {
            jasmine.clock().install();
            jasmine.clock().mockDate();
            await bridge.run(101, {}, appService);
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
                sender: "@foo:bar",
                room_id: "!flibble:bar",
                type: "m.room.member"
            };
            appService.emit("event", joinEvent);
            intent.join("!flibble:bar").then(() => {
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
                sender: "@foo:bar",
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
            }).then(() => {
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
            bridge.run(101, {}, appService).then(function() {
                done();
            });
        });

        it("should provision a user with the specified user ID", function() {
            var mxUser = new MatrixUser("@foo:bar");
            var provisionedUser = {};
            var botClient = clients["bot"];
            botClient.register.and.returnValue(Promise.resolve({}));
            return bridge.provisionUser(mxUser, provisionedUser).then(function() {
                expect(botClient.register).toHaveBeenCalledWith(mxUser.localpart);
                // should also be persisted in storage
                return bridge.getUserStore().getMatrixUser("@foo:bar");
            }).then((usr) => {
                expect(usr).toBeDefined();
                expect(usr.getId()).toEqual("@foo:bar");
            });
        });

        it("should set the display name if one was provided", function() {
            var mxUser = new MatrixUser("@foo:bar");
            var provisionedUser = {
                name: "Foo Bar"
            };
            var botClient = clients["bot"];
            botClient.register.and.returnValue(Promise.resolve({}));
            var client = mkMockMatrixClient("@foo:bar");
            client.setDisplayName.and.returnValue(Promise.resolve({}));
            clients["@foo:bar"] = client;
            return bridge.provisionUser(mxUser, provisionedUser).then(() => {
                expect(botClient.register).toHaveBeenCalledWith(mxUser.localpart);
                expect(client.setDisplayName).toHaveBeenCalledWith("Foo Bar");
            });
        });

        it("should set the avatar URL if one was provided", function() {
            var mxUser = new MatrixUser("@foo:bar");
            var provisionedUser = {
                url: "http://avatar.jpg"
            };
            var botClient = clients["bot"];
            botClient.register.and.returnValue(Promise.resolve({}));
            var client = mkMockMatrixClient("@foo:bar");
            client.setAvatarUrl.and.returnValue(Promise.resolve({}));
            clients["@foo:bar"] = client;
            return bridge.provisionUser(mxUser, provisionedUser).then(() => {
                expect(botClient.register).toHaveBeenCalledWith(mxUser.localpart);
                expect(client.setAvatarUrl).toHaveBeenCalledWith("http://avatar.jpg");
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
            }).then(function(users) {
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
            const err = { errcode: "M_FORBIDDEN" };
            const errorPromise = Promise.reject(err)
            botClient.register.and.returnValue(errorPromise);
            bridge.provisionUser(mxUser, provisionedUser).catch(function(ex) {
                expect(ex).toBe(err);
                expect(botClient.register).toHaveBeenCalledWith(mxUser.localpart);
                done();
            });
            // This complains otherwise.
            errorPromise.catch((ex) => {});
        });
    });

    describe("_onEvent", () => {
        it("should not upgrade a room if state_key is not defined", () => {
            bridge.roomUpgradeHandler = jasmine.createSpyObj("_roomUpgradeHandler", ["onTombstone"]);
            bridge.roomUpgradeHandler.onTombstone.and.returnValue(Promise.resolve({}));
            bridgeCtrl.onEvent.and.callFake(function(req) { req.resolve(); });
            bridge.opts.roomUpgradeOpts = { consumeEvent: true };
            return bridge.run(101, {}, appService).then(() => {
                return bridge.onEvent({
                    type: "m.room.tombstone",
                    state_key: undefined,
                    sender: "@foo:bar",
                });
            }).then(() => {
                expect(bridge.roomUpgradeHandler.onTombstone).not.toHaveBeenCalled();
            });
        });

        it("should not upgrade a room if state_key is not === '' ", () => {
            bridge.roomUpgradeHandler = jasmine.createSpyObj("_roomUpgradeHandler", ["onTombstone"]);
            bridge.roomUpgradeHandler.onTombstone.and.returnValue(Promise.resolve({}));
            bridgeCtrl.onEvent.and.callFake(function(req) { req.resolve(); });
            bridge.opts.roomUpgradeOpts = { consumeEvent: true };
            return bridge.run(101, {}, appService).then(() => {
                return bridge.onEvent({
                    type: "m.room.tombstone",
                    state_key: "fooobar",
                    sender: "@foo:bar",
                });
            }).then(() => {
                expect(bridge.roomUpgradeHandler.onTombstone).not.toHaveBeenCalled();
                return bridge.onEvent({
                    type: "m.room.tombstone",
                    state_key: 212345,
                    sender: "@foo:bar",
                });
            }).then(() => {
                expect(bridge.roomUpgradeHandler.onTombstone).not.toHaveBeenCalled();
                return bridge.onEvent({
                    type: "m.room.tombstone",
                    state_key: null,
                    sender: "@foo:bar",
                });
            }).then(() => {
                expect(bridge.roomUpgradeHandler.onTombstone).not.toHaveBeenCalled();
            });
        });

        it("should upgrade a room if state_key == '' is defined", () => {
            bridge.roomUpgradeHandler = jasmine.createSpyObj("_roomUpgradeHandler", ["onTombstone"]);
            bridge.roomUpgradeHandler.onTombstone.and.returnValue(Promise.resolve({}));
            bridgeCtrl.onEvent.and.callFake(function(req) { req.resolve(); });
            bridge.opts.roomUpgradeOpts = { consumeEvent: true };
            return bridge.run(101, {}, appService).then(() => {
                return bridge.onEvent({
                    type: "m.room.tombstone",
                    state_key: "",
                    sender: "@foo:bar",
                });
            }).then(() => {
                expect(bridge.roomUpgradeHandler.onTombstone).toHaveBeenCalled();
            });
        });
    });
});

function mkMockMatrixClient(uid) {
    var client = jasmine.createSpyObj(
        "MatrixClient", [
            "register", "joinRoom", "credentials", "createRoom", "setDisplayName",
            "setAvatarUrl", "fetchRoomEvent", "getJoinedRoomMembers", "_http"
        ]
    );
    // Shim requests to authedRequestWithPrefix to register() if it is
    // directed at /register
    client._http.authedRequest = jasmine.createSpy("authedRequest");
    client._http.authedRequest.and.callFake(function(a, method, path, d, data) {
        if (method === "POST" && path === "/register") {
            return client.register(data.user);
        }
        return undefined;
    });
    client.credentials.userId = uid;
    return client;
}
