"use strict";
var Promise = require("bluebird");
var AppServiceRegistration = require("matrix-appservice").AppServiceRegistration;
var Cli = require("..").Cli;
var Bridge = require("..").Bridge;
var RemoteUser = require("..").RemoteUser;
var WebSocket = require('ws');

var REGISTRATION_FILE = "verto-registration.yaml";
var CONFIG_SCHEMA_FILE = "verto-config-schema.yaml";
var USER_PREFIX = "fs_";

function runBridge(port, config) {
    // Create a verto instance and login, then listen on the bridge.
    var verto = new VertoEndpoint(config["verto-bot"].url, function(msg) {
        if (!msg.method) {
            return;
        }
        switch (msg.method) {
            case "verto.answer":
                break;
            case "verto.invite":
                break;
            case "verto.media":
                break;
            default:
                console.log("Unhandled method: %s", msg.method);
                break;
        }
    });

    var calls = {}; // call_id: 

    var bridgeInst = new Bridge({
        homeserverUrl: config.homeserver.url,
        domain: config.homeserver.domain,
        registration: REGISTRATION_FILE,

        controller: {
            onUserQuery: function(queriedUser) {
                // auto-create "users" when queried. @fs_#matrix:foo -> "#matrix"
                return {
                    name: queriedUser.localpart.replace(USER_PREFIX, "")
                };
            },

            onEvent: function(request, context) {
                var event = request.getData();
                console.log(
                    "%s: [%s] in [%s]: %s",
                    event.type, event.user_id, event.room_id,
                    JSON.stringify(event.content)
                );
                if (event.type === "m.room.member") {

                }
                else if (event.type === "m.call.invite") {
                    // store event.content.offer.sdp and call ID
                    // got enough candidates when SDP has a server-reflexive
                    // candidates (SRFLX or RELAY or 5s)
                    // de-trickle candidates
                    // send out verto.invite
                }
                else if (event.type === "m.call.candidates") {
                    // got enough candidates when SDP has a server-reflexive
                    // candidate
                    // de-trickle candidates
                    // send out verto.invite
                }
                else if (event.type === "m.call.answer") {
                    // TODO: send verto.answer
                }
                else if (event.type === "m.call.hangup") {
                    // send verto.bye
                }
            },

            onLog: function(text, isError) {
                console.log(text);
            }
        }
    });

    verto.login(
        config["verto-dialog-params"].login,
        config["verto-config"].passwd
    ).done(function() {
        bridgeInst.run(port, config);
        console.log("Running bridge on port %s", port);
    }, function(err) {
        console.error("Failed to login to verto: %s", JSON.stringify(err));
    });
}

// === Verto Endpoint ===
function VertoEndpoint(url, callback) {
    this.url = url;
    this.ws = null;
    this.sessionId = Date.now();
    this.callback = callback;
    this.requestId = 0;
    this.requests = {};
}

VertoEndpoint.prototype.login = function(user, pass) {
    var self = this;
    var defer = Promise.defer();
    this.ws = new WebSocket(this.url);
    this.ws.on('open', function() {
        console.log("WebSocket[%s]: OPEN", self.url);
        self.sendRequest("login", {
            login: user,
            passwd: pass,
            sessid: self.sessionId
        }).done(function() {
            defer.resolve();
        }, function(err) {
            defer.reject(err);
        });
    });
    this.ws.on('message', function(message) {
        console.log("WebSocket[%s]: MESSAGE %s", self.url, message);
        var jsonMessage;
        try {
            jsonMessage = JSON.parse(message);
        }
        catch(e) {
            console.error("Failed to parse: %s", e);
            return;
        }
        var req = self.requests[jsonMessage.id];
        if (req) {
            if (jsonMessage.error) {
                req.reject(jsonMessage.error);
            }
            else if (jsonMessage.result) {
                req.resolve(jsonMessage.result);
            }
            else {
                console.error("WebSocket[%s]: Response is malformed.", self.url);
                req.resolve(jsonMessage); // I guess?
            }
        }
        self.callback(jsonMessage);
    });
    return defer.promise;
};

VertoEndpoint.prototype.send = function(stuff) {
    console.log("WebSocket[%s]: SEND %s", this.url, stuff);
    var defer = Promise.defer();
    this.ws.send(stuff, function(err) {
        if (err) {
            defer.reject(err);
            return;
        }
        defer.resolve();
    });
    return defer.promise;
}

VertoEndpoint.prototype.sendRequest = function(method, params, id) {
    this.requestId += 1;
    this.requests[this.requestId] = Promise.defer();
    // The request is OK if we can send it down the wire AND get
    // a non-error response back. This promise will fail if either fail.
    return Promise.all([
        this.send(JSON.stringify({
            jsonrpc: "2.0",
            method: method,
            params: params,
            id: this.requestId
        })),
        this.requests[this.requestId].promise
    ]);
};

VertoEndpoint.prototype.sendResponse = function(result, id) {
    return this.send(JSON.stringify({
        jsonrpc: "2.0",
        result: result,
        id: id
    }));
};

// === Command Line Interface ===
var c = new Cli({
    registrationPath: REGISTRATION_FILE,
    bridgeConfig: {
        schema: CONFIG_SCHEMA_FILE
    },
    generateRegistration: function(appServiceUrl, callback) {
        var reg = new AppServiceRegistration(appServiceUrl);
        reg.setHomeserverToken(AppServiceRegistration.generateToken());
        reg.setAppServiceToken(AppServiceRegistration.generateToken());
        reg.setSenderLocalpart("vertobot");
        console.log(
            "Generating registration to '%s' for the AS accessible from: %s",
            REGISTRATION_FILE, appServiceUrl
        );
        callback(reg);
    },
    run: runBridge
});

c.run(); // check system args
