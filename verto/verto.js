"use strict";
var Promise = require("bluebird");
var AppServiceRegistration = require("matrix-appservice").AppServiceRegistration;
var Cli = require("..").Cli;
var Bridge = require("..").Bridge;
var MatrixRoom = require("..").MatrixRoom;
var WebSocket = require('ws');
var uuid = require("uuid");

var REGISTRATION_FILE = "verto-registration.yaml";
var CONFIG_SCHEMA_FILE = "verto-config-schema.yaml";
var USER_PREFIX = "fs_";
var CANDIDATE_TIMEOUT_MS = 1000 * 3; // 3s

function runBridge(port, config) {
    var verto, bridgeInst;
    var calls = {}; // room_id+call_id: CallStruct
    var callsById = {}; // call_id: room_id

    // Create a verto instance and login, then listen on the bridge.
    verto = new VertoEndpoint(config.verto.url, config["verto-dialog-params"],
    function(msg) { // handle the incoming verto request
        switch (msg.method) {
            case "verto.answer":
                if (!msg.params || !msg.params.sdp || msg.params.callID === undefined) {
                    console.error("Missing SDP and/or CallID");
                    return;
                }
                var callStruct = callsById[msg.params.callID];
                if (!callStruct) {
                    console.error("No call with ID '%s' exists.", msg.params.callID);
                    return;
                }

                // find out which user should be sending the answer
                bridgeInst.getRoomStore().getMatrixRoom(callStruct.roomId).then(
                function(room) {
                    if (!room) {
                        throw new Error("Unknown room ID: " + callStruct.roomId);
                    }
                    var sender = room.get("fs_user");
                    if (!sender) {
                        throw new Error("Room " + callStruct.roomId + " has no fs_user");
                    }
                    var intent = bridgeInst.getIntent(sender);
                    return intent.sendEvent(callStruct.roomId, "m.call.answer", {
                        call_id: callStruct.callId,
                        version: 0,
                        answer: {
                            sdp: msg.params.sdp,
                            type: "answer"
                        }
                    });
                }).then(function() {
                    return verto.sendResponse({
                        method: msg.method
                    }, msg.id);
                }).done(function() {
                    console.log("Forwarded answer.");
                }, function(err) {
                    console.error("Failed to send m.call.answer: %s", err);
                    console.log(err.stack);
                    // TODO send verto error response?
                });
                break;
            case "verto.invite":
                break;
            default:
                console.log("Unhandled method: %s", msg.method);
                break;
        }
    });

    bridgeInst = new Bridge({
        homeserverUrl: config.homeserver.url,
        domain: config.homeserver.domain,
        registration: REGISTRATION_FILE,

        controller: {
            onUserQuery: function(queriedUser) {
                // auto-create "users" when queried. @fs_#matrix:foo -> "#matrix (Room)"
                return {
                    name: queriedUser.localpart.replace(USER_PREFIX, "") + " (Room)"
                };
            },

            onEvent: function(request, context) {
                var event = request.getData();
                var callStruct;
                console.log(
                    "[%s] %s: from=%s in %s: %s\n",
                    request.getId(), event.type, event.user_id, event.room_id,
                    JSON.stringify(event.content)
                );
                // auto-accept invites directed to @fs_ users
                if (event.type === "m.room.member" &&
                        event.content.membership === "invite" &&
                        context.targets.matrix.localpart.indexOf(USER_PREFIX) === 0) {
                    var intent = bridgeInst.getIntent(context.targets.matrix.getId());
                    request.outcomeFrom(intent.join(event.room_id).then(function() {
                        // pair this user with this room ID
                        var room = new MatrixRoom(event.room_id);
                        room.set("fs_user", context.targets.matrix.getId());
                        room.set("inviter", event.user_id);
                        return bridgeInst.getRoomStore().setMatrixRoom(room);
                    }));
                }
                else if (event.type === "m.call.invite") {
                    callStruct = {
                        callId: event.content.call_id,
                        roomId: event.room_id,
                        offer: event.content.offer.sdp,
                        candidates: [],
                        timer: null,
                        sentInvite: false
                    };
                    calls[event.room_id + event.content.call_id] = callStruct;
                    callsById[callStruct.callId] = callStruct;
                    request.outcomeFrom(verto.attemptInvite(callStruct, false));
                }
                else if (event.type === "m.call.candidates") {
                    callStruct = calls[event.room_id + event.content.call_id];
                    if (!callStruct) {
                        request.reject("Received candidates for unknown call");
                        return;
                    }
                    event.content.candidates.forEach(function(cand) {
                        callStruct.candidates.push(cand);
                    });
                    request.outcomeFrom(verto.attemptInvite(callStruct, false));
                }
                else if (event.type === "m.call.answer") {
                    // TODO: send verto.answer
                }
                else if (event.type === "m.call.hangup") {
                    // send verto.bye
                    callStruct = calls[event.room_id + event.content.call_id];
                    if (!callStruct) {
                        request.reject("Received hangup for unknown call");
                        return;
                    }
                    request.outcomeFrom(verto.sendBye(callStruct));
                    delete calls[event.room_id + event.content.call_id];
                }
            }
        }
    });

    verto.login(
        config["verto-dialog-params"].login,
        config.verto.passwd
    ).done(function() {
        bridgeInst.run(port, config);
        console.log("Running bridge on port %s", port);
    }, function(err) {
        console.error("Failed to login to verto: %s", JSON.stringify(err));
        process.exit(1);
    });
}

// === Verto Endpoint ===
function VertoEndpoint(url, dialogParams, callback) {
    this.url = url;
    this.ws = null;
    this.sessionId = uuid.v4();
    this.callback = callback;
    this.requestId = 0;
    this.requests = {};
    this.dialogParams = dialogParams;
}

VertoEndpoint.prototype.login = function(user, pass) {
    var self = this;
    var defer = Promise.defer();
    this.ws = new WebSocket(this.url);
    this.ws.on('open', function() {
        console.log("[%s]: OPENED", self.url);
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
        console.log("[%s]: MESSAGE %s\n", self.url, message);
        var jsonMessage;
        try {
            jsonMessage = JSON.parse(message);
        }
        catch(e) {
            console.error("Failed to parse: %s", e);
            return;
        }
        var existingRequest = self.requests[jsonMessage.id];
        if (existingRequest) {  // check for promises to resolve/reject
            if (jsonMessage.error) {
                existingRequest.reject(jsonMessage.error);
            }
            else if (jsonMessage.result) {
                existingRequest.resolve(jsonMessage.result);
            }
            else {
                console.error("[%s]: Response is malformed.", self.url);
                existingRequest.resolve(jsonMessage); // I guess?
            }
        }
        else if (jsonMessage.method) {
            self.callback(jsonMessage);
        }
    });
    return defer.promise;
};

VertoEndpoint.prototype.attemptInvite = function(callStruct, force) {
    if (callStruct.candidates.length === 0) { return Promise.resolve(); }
    var self = this;

    var enoughCandidates = false;
    for (var i = 0; i < callStruct.candidates.length; i++) {
        var c = callStruct.candidates[i];
        if (!c.candidate) { continue; }
        // got enough candidates when SDP has a srflx or relay candidate
        if (c.candidate.indexOf("typ srflx") !== -1 ||
                c.candidate.indexOf("typ relay") !== -1) {
            enoughCandidates = true;
            console.log("Gathered enough candidates for %s", callStruct.callId);
            break; // bail early
        }
    };

    if (!enoughCandidates && !force) { // don't send the invite just yet
        if (!callStruct.timer) {
            callStruct.timer = setTimeout(function() {
                console.log("Timed out. Forcing invite for %s", callStruct.callId);
                self.attemptInvite(callStruct, true);
            }, CANDIDATE_TIMEOUT_MS);
            console.log("Call %s is waiting for candidates...", callStruct.callId);
            return Promise.resolve("Waiting for candidates");
        }
    }

    if (callStruct.timer) {  // cancel pending timers
        clearTimeout(callStruct.timer);
    }
    if (callStruct.sentInvite) {  // e.g. timed out and then got more candidates
        return Promise.resolve("Invite already sent");
    }

    // de-trickle candidates - insert the candidates in the right m= block.
    // Insert the candidate line at the *END* of the media block
    // (RFC 4566 Section 5; order is m,i,c,b,k,a) - we'll just insert at the
    // start of the a= lines for parsing simplicity)
    var mIndex = -1;
    var mType = "";
    var parsedUpToIndex = -1;
    callStruct.offer = callStruct.offer.split("\r\n").map(function(line) {
        if (line.indexOf("m=") === 0) { // m=audio 48202 RTP/SAVPF 111 103
            mIndex += 1;
            mType = line.split(" ")[0].replace("m=", ""); // 'audio'
            console.log("index=%s - %s", mIndex, line);
        }
        if (mIndex === -1) { return line; } // ignore session-level keys
        if (line.indexOf("a=") !== 0) { return line; } // ignore keys before a=
        if (parsedUpToIndex === mIndex) { return line; } // don't insert cands f.e a=

        callStruct.candidates.forEach(function(cand) {
            // m-line index is more precise than the type (which can be multiple)
            // so prefer that when inserting
            if (cand.sdpMLineIndex != null) { // allows 0
                if (cand.sdpMLineIndex !== mIndex) {
                    return;
                }
                line = "a=" + cand.candidate + "\r\n" + line;
                console.log(
                    "Inserted candidate %s at m= index %s",
                    cand.candidate, cand.sdpMLineIndex
                );
            }
            else if (cand.sdpMid != null && cand.sdpMid === mType) {
                // insert candidate f.e. m= type (e.g. audio)
                // This will repeatedly insert the candidate for m= blocks with
                // the same type (unconfirmed if this is the 'right' thing to do)
                line = "a=" + cand.candidate + "\r\n" + line;
                console.log(
                    "Inserted candidate %s at m= type %s",
                    cand.candidate, cand.sdpMid
                );
            }
        });
        parsedUpToIndex = mIndex;
        return line;
    }).join("\r\n");

    var dialogParams = JSON.parse(JSON.stringify(this.dialogParams));
    dialogParams.callID = callStruct.callId;
    callStruct.sentInvite = true;
    return this.sendRequest("verto.invite", {
        sdp: callStruct.offer,
        dialogParams: dialogParams,
        sessid: this.sessionId
    });
};

VertoEndpoint.prototype.sendBye = function(callStruct) {
    var dialogParams = JSON.parse(JSON.stringify(this.dialogParams));
    dialogParams.callID = callStruct.callId;
    return this.sendRequest("verto.bye", {
        dialogParams: dialogParams,
        sessid: this.sessionId
    });
}

VertoEndpoint.prototype.send = function(stuff) {
    console.log("[%s]: SENDING %s\n", this.url, stuff);
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
        reg.addRegexPattern("users", "@" + USER_PREFIX + ".*", true);
        console.log(
            "Generating registration to '%s' for the AS accessible from: %s",
            REGISTRATION_FILE, appServiceUrl
        );
        callback(reg);
    },
    run: runBridge
});

c.run(); // check system args
