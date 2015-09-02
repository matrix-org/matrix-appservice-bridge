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
var Bridge = require("../..").Bridge;

describe("Bridge", function() {
    var bridge, bridgeCtrl, appService, clientFactory, appServiceRegistration;

    beforeEach(
    /** @this */
    function(done) {
        log.beforeEach(this);
        clientFactory = jasmine.createSpyObj("ClientFactory", [
            "setLogFunction", "getClientAs", "configure"
        ]);
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
        bridgeCtrl = jasmine.createSpyObj("controller", [
            "onEvent", "onAliasQuery", "onUserQuery"
        ]);
        appServiceRegistration = jasmine.createSpyObj("AppServiceRegistration", [
            "getOutput", "isUserMatch", "isAliasMatch", "isRoomMatch"
        ]);
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

        });
    });

    describe("getters", function() {
        it("should be able to getRoomStore", function() {

        });

        it("should be able to getUserStore", function() {

        });

        it("should be able to getRequestFactory", function() {

        });

        it("should be able to getBot", function() {

        });
    });

    describe("getIntent", function() {
        it("should return the same intent on multiple invokations", function() {

        });

        it("should keep the Intent up-to-date with incoming events", function() {

        });

        it("should scope Intents to a request if provided", function() {

        });

        it("should provision a user with the specified user ID", function() {

        });
    });

    describe("provisionUser", function() {
        it("should provision a user with the specified user ID", function() {

        });

        it("should set the display name if one was provided", function() {

        });

        it("should set the avatar URL if one was provided", function() {

        });

        it("should link the user with a remote user if one was provided", function() {

        });

        it("should fail if the HTTP registration fails", function() {

        });
    });
});
