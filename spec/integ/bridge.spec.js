"use strict";
const Datastore = require("nedb");
const fs = require("fs");

const HS_URL = "http://example.com";
const HS_DOMAIN = "example.com";
const BOT_LOCALPART = "the_bridge";
const BOT_USER_ID = `@${BOT_LOCALPART}:${HS_DOMAIN}`;

const TEST_USER_DB_PATH = __dirname + "/test-users.db";
const TEST_ROOM_DB_PATH = __dirname + "/test-rooms.db";
const TEST_EVENT_DB_PATH = __dirname + "/test-events.db";
const { UserBridgeStore, RoomBridgeStore, EventBridgeStore, MatrixUser,
    RemoteUser, MatrixRoom, RemoteRoom, AppServiceRegistration, Bridge,
    BRIDGE_PING_EVENT_TYPE, BRIDGE_PING_TIMEOUT_MS, Intent } = require("../..");

const deferPromise = require("../../lib/utils/promiseutil").defer;

describe("Bridge", function() {
    let bridge, bridgeCtrl, appService, appServiceRegistration, intents, intentCreateFn;
    let roomStore, userStore, eventStore;
    let userIsRegistered;

    beforeEach(async function() {
        userIsRegistered = true;
        intentCreateFn = (userId, opts) => {
            const underlyingClient = jasmine.createSpyObj("underlyingClient", [
                'createRoom', 'sendEvent', 'getJoinedRoomMembers', 'getEvent', 'joinRoom',
                'resolveRoom', 'setDisplayName', 'setAvatarUrl'
            ]);
            const botSdkIntent = jasmine.createSpyObj("botSdkIntent", [
                'underlyingClient', 'ensureRegistered',
            ]);
            const botClient = jasmine.createSpyObj("botClient", [
                'createRoom'
            ]);
            underlyingClient.resolveRoom.and.callFake((roomId) => roomId);
            botSdkIntent.underlyingClient = underlyingClient;
            botSdkIntent.userId = userId;
            return new Intent(botSdkIntent, botClient, { ...opts, registered: userIsRegistered });
        }
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
            const db = new Datastore({
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

        await Promise.all([
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
                onIntentCreate: (...args) => intentCreateFn(...args),
            });
            return bridge.loadDatabases();
        });

        // Mock the BotSdk Intents
        // ---
        intents = bridge.intents;
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
        const userId = `@alice:${HS_DOMAIN}`;
        it("should invoke the user-supplied onUserQuery function with the right args", async() => {
            await bridge.run(101, appService);
            try {
                await appService.onUserQuery(userId);
            }
            catch (error) {
                // do nothing
            }
            finally {
                expect(bridgeCtrl.onUserQuery).toHaveBeenCalled();
                const [mxUser] = bridgeCtrl.onUserQuery.calls.argsFor(0);
                expect(mxUser.getId()).toEqual(userId);
            }
        });

        it("should not provision a user if null is returned from the function",
        async function() {
            bridgeCtrl.onUserQuery.and.returnValue(null);
            await bridge.run(101, appService);
            try {
                await appService.onUserQuery(userId);
            }
            catch (ex) {
                //...
            }
            expect([...intents.keys()]).not.toContain(userId);
        });

        it("should provision the user from the return object", async() => {
            bridgeCtrl.onUserQuery.and.returnValue({});
            await bridge.run(101, appService);
            await appService.onUserQuery(userId);
            expect([...intents.keys()]).toContain(userId);
        });
    });

    describe("onAliasQuery", function() {
        it("should invoke the user-supplied onAliasQuery function with the right args",
        async function() {
            await bridge.run(101, appService);

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
            await bridge.run(101, appService);
            try {
                await appService.onAliasQuery("#foo:bar");
                fail(new Error('We expect `onAliasQuery` to fail and throw an error'))
            }
            catch (err) {
                expect(bridge.botIntent.botSdkIntent.underlyingClient.createRoom).not.toHaveBeenCalled();
            }
        });

        it("should not create a room if roomId is returned from the function but should still store it",
        async function() {
            bridgeCtrl.onAliasQuery.and.returnValue({ roomId: "!abc123:bar" });
            await bridge.run(101, appService);

            await appService.onAliasQuery("#foo:bar");

            expect(bridge.botIntent.botSdkIntent.underlyingClient.createRoom).not.toHaveBeenCalled();

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
            await bridge.run(101, appService);
            bridge.botIntent.botSdkIntent.underlyingClient.createRoom.and.returnValue("!abc123:bar");
            bridgeCtrl.onAliasQuery.and.returnValue(provisionedRoom);
            await appService.onAliasQuery("#foo:bar");
            expect(bridge.botIntent.botSdkIntent.underlyingClient.createRoom).toHaveBeenCalledWith(
                provisionedRoom.creationOpts
            );
        });

        it("should store the new matrix room", async() => {
            await bridge.run(101, appService);
            bridge.botIntent.botSdkIntent.underlyingClient.createRoom.and.returnValue("!abc123:bar");
            bridgeCtrl.onAliasQuery.and.returnValue({
                creationOpts: {
                    room_alias_name: "foo",
                },
            });
            await appService.onAliasQuery("#foo:bar");

            const room = await bridge.getRoomStore().getMatrixRoom("!abc123:bar");
            expect(room).toBeDefined();
            expect(room.getId()).toEqual("!abc123:bar");
        });

        it("should store and link the new matrix room if a remote room was supplied", async() => {
            await bridge.run(101, appService);
            bridge.botIntent.botSdkIntent.underlyingClient.createRoom.and.returnValue("!abc123:bar");
            bridgeCtrl.onAliasQuery.and.returnValue({
                creationOpts: {
                    room_alias_name: "foo",
                },
                remote: new RemoteRoom("__abc__")
            });

            await appService.onAliasQuery("#foo:bar");

            const rooms = await bridge.getRoomStore().getLinkedRemoteRooms("!abc123:bar");
            expect(rooms.length).toEqual(1);
            expect(rooms[0].getId()).toEqual("__abc__");
        });
    });

    describe("pingAppserviceRoute", () => {
        it("should return successfully when the bridge receives it's own self ping", async () => {
            let sentEvent = false;
            await bridge.run(101, appService);
            bridge.botIntent._ensureJoined = async () => true;
            bridge.botIntent._ensureHasPowerLevelFor = async () => true;
            bridge.botIntent.botSdkIntent.underlyingClient.sendEvent.and.callFake(async () => {sentEvent = true});
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
            await bridge.run(101, appService);
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
            const event = {
                content: {
                    body: "oh noes!",
                    LogEntryPart: "m.text"
                },
                sender: "@virtual_foo:bar",
                room_id: "!flibble:bar",
                type: "m.room.message"
            };
            await bridge.run(101, appService);
            await appService.emit("event", event);
            expect(bridgeCtrl.onEvent).not.toHaveBeenCalled();
        });

        describe('opts.eventValidation.validateEditSender', () => {
            let botClient;
            async function setupBridge(eventValidation) {
                const bridge = new Bridge({
                    homeserverUrl: HS_URL,
                    domain: HS_DOMAIN,
                    registration: appServiceRegistration,
                    userStore: userStore,
                    roomStore: roomStore,
                    controller: bridgeCtrl,
                    disableContext: true,
                    eventValidation,
                    onIntentCreate: (...args) => intentCreateFn(...args),
                });
                await bridge.run(101, appService);
                botClient = bridge.botIntent.botSdkIntent.underlyingClient;
                botClient.getJoinedRoomMembers.and.returnValue(Promise.resolve(
                    [bridge.botUserId]
                ));

                // Mock onEvent callback
                bridgeCtrl.onEvent.and.callFake(function(req) { req.resolve(); });

                return bridge;
            }

            function createMessageEditEvent(sender) {
                const event = {
                    content: {
                        body: ' * my message edit',
                        'm.new_content': { body: 'my message edit', LogEntryPart: 'm.text' },
                        'm.relates_to': { 
                            event_id: '$ZrXenSQt4TbtHnMclrWNJdiP7SrRCSdl3tAYS81H2bs',
                            rel_type: 'm.replace' 
                        },
                    LogEntryPart: 'm.text'
                    },
                    event_id: '$tagvjsXZqBOBWtHijq2qg0Un-uqVunrFLxiJyOIVGQ8',
                    room_id: '!dtJaPyDtsoOLTgJVmy:my.matrix.host',
                    sender,
                    type: 'm.room.message',
                };

                return event;
            }

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

                    botClient.getEvent.and.returnValue(Promise.resolve({
                        event_id: '$ZrXenSQt4TbtHnMclrWNJdiP7SrRCSdl3tAYS81H2bs',
                        // The original message has different sender than the edit event
                        sender: '@some-other-user:different.host',
                    }));

                    await appService.emit("event", event);
                    expect(bridgeCtrl.onEvent).not.toHaveBeenCalled();
                });

                it("should emit event when the edit sender matches the original message sender", async() => {
                    const event = createMessageEditEvent('@root:my.matrix.host');
                    
                    botClient.getEvent.and.returnValue(Promise.resolve({
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

                const botClient = bridge.botIntent.botSdkIntent.underlyingClient;
                botClient.getJoinedRoomMembers.and.returnValue(Promise.resolve(
                    [bridge.botUserId]
                ));
                botClient.getEvent.and.returnValue(Promise.reject(new Error('Some problem fetching original event')));

                await appService.emit("event", event);
                expect(bridgeCtrl.onEvent).toHaveBeenCalled();
            })

            describe('when disabled', () => {
                it("should emit event even when the edit sender does NOT match the original message sender", async() => {
                    const event = createMessageEditEvent('@root:my.matrix.host');
                    
                    bridge = await setupBridge(undefined)

                    botClient.getEvent.and.returnValue(Promise.resolve({
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
            const event = {
                content: {
                    body: "oh noes!",
                    LogEntryPart: "m.text"
                },
                sender: "@foo:bar",
                room_id: "!flibble:bar",
                type: "m.room.message"
            };
            bridgeCtrl.onEvent.and.callFake(function(req) { req.resolve(); });

            bridge.run(101, appService).then(function() {
                return appService.emit("event", event);
            }).then(function() {
                expect(bridgeCtrl.onEvent).toHaveBeenCalled();
                const call = bridgeCtrl.onEvent.calls.argsFor(0);
                const req = call[0];
                const ctx = call[1];
                expect(req.getData()).toEqual(event);
                expect(ctx.senders.matrix.getId()).toEqual("@foo:bar");
                expect(ctx.rooms.matrix.getId()).toEqual("!flibble:bar");
                done();
            });
        });

        it("should include remote senders in the context if applicable", async() => {
            const event = {
                content: {
                    body: "oh noes!",
                    LogEntryPart: "m.text"
                },
                sender: "@alice:bar",
                room_id: "!flibble:bar",
                type: "m.room.message"
            };
            bridgeCtrl.onEvent.and.callFake(function(req) { req.resolve(); });

            await bridge.run(101, appService)
            await bridge.getUserStore().linkUsers(
                new MatrixUser("@alice:bar"),
                new RemoteUser("__alice__")
            );
            await appService.emit("event", event);
            expect(bridgeCtrl.onEvent).toHaveBeenCalled();
            const call = bridgeCtrl.onEvent.calls.argsFor(0);
            const [req, ctx] = call;
            expect(req.getData()).toEqual(event);
            expect(ctx.senders.remote.getId()).toEqual("__alice__");
            expect(ctx.senders.remotes.length).toEqual(1);
        });

        it("should include remote targets in the context if applicable", async() => {
            const event = {
                content: {
                    membership: "invite"
                },
                state_key: "@bob:bar",
                sender: "@alice:bar",
                room_id: "!flibble:bar",
                type: "m.room.member"
            };
            bridgeCtrl.onEvent.and.callFake(function(req) { req.resolve(); });

            await bridge.run(101, appService);
            await bridge.getUserStore().linkUsers(
                new MatrixUser("@bob:bar"),
                new RemoteUser("__bob__")
            );
            await appService.emit("event", event);
            expect(bridgeCtrl.onEvent).toHaveBeenCalled();
            const call = bridgeCtrl.onEvent.calls.argsFor(0);
            const [req, ctx] = call;
            expect(req.getData()).toEqual(event);
            expect(ctx.targets.remote.getId()).toEqual("__bob__");
            expect(ctx.targets.remotes.length).toEqual(1);
        });

        it("should include remote rooms in the context if applicable",
        function(done) {
            const event = {
                content: {
                    membership: "invite"
                },
                state_key: "@bob:bar",
                sender: "@alice:bar",
                room_id: "!flibble:bar",
                type: "m.room.member"
            };
            bridgeCtrl.onEvent.and.callFake(function(req) { req.resolve(); });

            bridge.run(101, appService).then(function() {
                return bridge.getRoomStore().linkRooms(
                    new MatrixRoom("!flibble:bar"),
                    new RemoteRoom("roomy")
                );
            }).then(function() {
                return appService.emit("event", event);
            }).then(function() {
                expect(bridgeCtrl.onEvent).toHaveBeenCalled();
                const call = bridgeCtrl.onEvent.calls.argsFor(0);
                const [req, ctx] = call;
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
                    LogEntryPart: "m.text"
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
                disableContext: true,
                onIntentCreate: (...args) => intentCreateFn(...args),
            });

            await bridge.run(101, appService);
            await appService.emit("event", event);
            expect(bridgeCtrl.onEvent).toHaveBeenCalled();
            const call = bridgeCtrl.onEvent.calls.argsFor(0);
            const [req, ctx] = call
            expect(req.getData()).toEqual(event);
            expect(ctx).toBeNull();
        });
    });

    describe("run", () => {
        it("should invoke listen(port) on the AppService instance", async() => {
            await bridge.run(101, appService);
            expect(appService.listen).toHaveBeenCalledWith(101, "0.0.0.0", 10);
        });
        it("should invoke listen(port, hostname) on the AppService instance", async() => {
            await bridge.run(101, appService, "foobar");
            expect(appService.listen).toHaveBeenCalledWith(101, "foobar", 10);
        });
    });

    describe("getters", function() {
        it("should be able to getRoomStore", async() => {
            await bridge.run(101, appService);
            expect(bridge.getRoomStore()).toEqual(roomStore);
        });

        it("should be able to getUserStore", async() => {
            await bridge.run(101, appService);
            expect(bridge.getUserStore()).toEqual(userStore);
        });

        it("should be able to getEventStore", async() => {
            await bridge.run(101, appService);
            expect(bridge.getEventStore()).toEqual(eventStore);
        });

        it("should be able to getRequestFactory", async() => {
            await bridge.run(101, appService);
            expect(bridge.getRequestFactory()).toBeDefined();
        });

        it("should be able to getBot", async() => {
            await bridge.run(101, appService);
            expect(bridge.getBot()).toBeDefined();
        });
    });

    describe("getIntent", function() {
        // 2h which should be long enough to cull it
        const cullTimeMs = 1000 * 60 * 60 * 2;

        beforeEach(async() => {
            jasmine.clock().install();
            jasmine.clock().mockDate();
            await bridge.run(101, appService);
        });

        afterEach(function() {
            jasmine.clock().uninstall();
        });

        it("should return the same intent on multiple invokations within the cull time",
        function() {
            const intent = bridge.getIntent("@foo:bar");
            // sentinel. If the same object is returned, this will be present.
            intent._test = 42;
            const intent2 = bridge.getIntent("@foo:bar");
            expect(intent).toEqual(intent2);
        });

        it(
        "should not return the same intent on multiple invokations outside the cull time",
        function() {
            const intent = bridge.getIntent("@foo:bar");
            // sentinel. If the same object is returned, this will be present.
            intent._test = 42;
            jasmine.clock().tick(cullTimeMs);
            const intent2 = bridge.getIntent("@foo:bar");
            expect(intent).not.toEqual(intent2);
        });

        it("should not cull intents which are accessed again via getIntent", function() {
            const intent = bridge.getIntent("@foo:bar");
            // sentinel. If the same object is returned, this will be present.
            intent._test = 42;

            // Call getIntent 1000 times evenly up to the cull time. If the cull time is
            // 2hrs, then this is called once every ~7.2s
            for (let i = 0; i < 1000; i ++) {
                jasmine.clock().tick(cullTimeMs/1000);
                bridge.getIntent("@foo:bar");
            }
            const intent2 = bridge.getIntent("@foo:bar");
            expect(intent).toEqual(intent2);
        });

        it("should keep the Intent up-to-date with incoming events", async() => {
            const intent = bridge.getIntent("@foo:bar");
            intent.botSdkIntent.underlyingClient.joinRoom.and.returnValue(Promise.resolve({})); // shouldn't be called

            const joinEvent = {
                content: {
                    membership: "join"
                },
                state_key: "@foo:bar",
                sender: "@foo:bar",
                room_id: "!flibble:bar",
                type: "m.room.member"
            };
            appService.emit("event", joinEvent);
            await intent.join("!flibble:bar");
            expect(intent.botSdkIntent.underlyingClient.joinRoom).not.toHaveBeenCalled();
        });

        it("should keep culled Intents up-to-date with incoming events", function() {
            // We tell the bridge that @foo:bar is joined to the room.
            // Therefore, we expect that intent.join() should NOT call the SDK's join
            // method. This should still be the case even if the Intent object is culled
            // and we try to join using a new intent, in addition to if we use the old
            // stale Intent.
            const intent = bridge.getIntent("@foo:bar");
            intent.botSdkIntent.underlyingClient.joinRoom.and.returnValue(Promise.resolve({})); // shouldn't be called

            const joinEvent = {
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

            return intent.join("!flibble:bar").then(function() {
                expect(intent.botSdkIntent.underlyingClient.joinRoom).not.toHaveBeenCalled();
                // wait the cull time again and use a new intent, still shouldn't join.
                jasmine.clock().tick(cullTimeMs);
                return bridge.getIntent("@foo:bar").join("!flibble:bar");
            }).then(() => {
                expect(intent.botSdkIntent.underlyingClient.joinRoom).not.toHaveBeenCalled();
            });
        });

        it("should scope Intents to a request if provided", function() {
            const intent = bridge.getIntent("@foo:bar");
            intent._test = 42; // sentinel
            const intent2 = bridge.getIntent("@foo:bar", {
                getId: function() { return "request id here"; }
            });
            expect(intent2).toBeDefined();
            expect(intent).not.toEqual(intent2);
        });

        it("should return an escaped userId",
        function() {
            const intent = bridge.getIntent("@foo£$&!£:bar");
            expect(intent.userId).toEqual("@foo=a3=24=26=21=a3:bar");
        });

        it("should not return an escaped userId if disabled",
        function() {
            bridge.opts.escapeUserIds = false;
            const intent = bridge.getIntent("@foo£$&!£:bar");
            expect(intent.userId).toEqual("@foo£$&!£:bar");
        });
    });

    describe("provisionUser", function() {

        beforeEach(() => {
            userIsRegistered = false;
            return bridge.initalise();
        });

        afterAll(() => {
            userIsRegistered = true;
        })

        it("should provision a user with the specified user ID", function() {
            const mxUser = new MatrixUser("@foo:example.com");
            const provisionedUser = {};
            const intent = bridge.getIntent(mxUser.getId());
            intent.botSdkIntent.ensureRegistered.and.returnValue(Promise.resolve({}));
            return bridge.provisionUser(mxUser, provisionedUser).then(function() {
                expect(intent.botSdkIntent.ensureRegistered).toHaveBeenCalled();
                // should also be persisted in storage
                return bridge.getUserStore().getMatrixUser("@foo:example.com");
            }).then((usr) => {
                expect(usr).toBeDefined();
                expect(usr.getId()).toEqual("@foo:example.com");
            });
        });

        it("should set the display name if one was provided", function() {
            const mxUser = new MatrixUser("@foo:example.com");
            const provisionedUser = {
                name: "Foo Bar"
            };
            const intent = bridge.getIntent(mxUser.getId());
            const botClient = intent.botSdkIntent;
            botClient.ensureRegistered.and.returnValue(Promise.resolve({}));
            botClient.underlyingClient.setDisplayName.and.returnValue(Promise.resolve({}));
            return bridge.provisionUser(mxUser, provisionedUser).then(() => {
                expect(botClient.ensureRegistered).toHaveBeenCalled();
                expect(botClient.underlyingClient.setDisplayName).toHaveBeenCalledWith("Foo Bar");
            });
        });

        it("should set the avatar URL if one was provided", function() {
            const mxUser = new MatrixUser("@foo:example.com");
            const provisionedUser = {
                url: "mxc://server/avatar.jpg"
            };
            const intent = bridge.getIntent(mxUser.getId());
            const botClient = intent.botSdkIntent;
            botClient.ensureRegistered.and.returnValue(Promise.resolve({}));
            botClient.underlyingClient.setAvatarUrl.and.returnValue(Promise.resolve({}));
            return bridge.provisionUser(mxUser, provisionedUser).then(() => {
                expect(botClient.ensureRegistered).toHaveBeenCalled();
                expect(botClient.underlyingClient.setAvatarUrl).toHaveBeenCalledWith("mxc://server/avatar.jpg");
            });
        });

        it("should link the user with a remote user if one was provided",
        function() {
            const mxUser = new MatrixUser("@foo:example.com");
            const provisionedUser = {
                remote: new RemoteUser("__remote__")
            };
            const intent = bridge.getIntent(mxUser.getId());
            const botClient = intent.botSdkIntent;
            botClient.ensureRegistered.and.returnValue(Promise.resolve({}));
            return bridge.provisionUser(mxUser, provisionedUser).then(function() {
                expect(botClient.ensureRegistered).toHaveBeenCalled();
                return bridge.getUserStore().getRemoteUsersFromMatrixId("@foo:example.com");
            }).then(function(users) {
                expect(users.length).toEqual(1);
                if (users.length > 0) {
                    expect(users[0].getId()).toEqual("__remote__");
                }
            });
        });

        it("should fail if the HTTP registration fails", function() {
            const provisionedUser = {};
            const mxUser = new MatrixUser("@foo:example.com");
            const intent = bridge.getIntent(mxUser.getId());
            const botClient = intent.botSdkIntent;
            const err =  { errcode: "M_FORBIDDEN" };
            const errorPromise = Promise.reject({ errcode: "M_FORBIDDEN" })
            // This complains otherwise.
            errorPromise.catch((ex) => {});
            botClient.ensureRegistered.and.returnValue(errorPromise);
            return bridge.provisionUser(mxUser, provisionedUser).catch(function(ex) {
                expect(ex).toEqual(err);
                expect(botClient.ensureRegistered).toHaveBeenCalled();
            });
        });
    });

    describe("_onEvent", () => {
        it("should not upgrade a room if state_key is not defined", () => {
            bridge.roomUpgradeHandler = jasmine.createSpyObj("_roomUpgradeHandler", ["onTombstone"]);
            bridge.roomUpgradeHandler.onTombstone.and.returnValue(Promise.resolve({}));
            bridgeCtrl.onEvent.and.callFake(function(req) { req.resolve(); });
            bridge.opts.roomUpgradeOpts = { consumeEvent: true };
            return bridge.run(101, appService).then(() => {
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
            return bridge.run(101, appService).then(() => {
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
            return bridge.run(101, appService).then(() => {
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