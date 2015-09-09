"use strict";
// TODO:
// - Check join state of user before dialling out to the conf server
// - Boot users off the conf when they leave rooms (fake a hangup)
// - Prevent randoms from accessing the conf (PIN or firewall)
// - GOTCHA: Knifing the web client will knife the RTP stream which is never
//   propagated to other users on the conference (read: the bridge). This means
//   the bridge will still think there is someone on that conf and will never
//   recycle the extension number. Over time, this will lead to total consumption
//   of conf calls.
// - TEST: Does it cycle from 98,99,00,01?
// - TEST: Does it fail gracefully (on the invite) if all conf exts are used?
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
var EXTENSION_PREFIX = "35"; // the 'destination_number' to dial: 35xx
var CANDIDATE_TIMEOUT_MS = 1000 * 3; // 3s

function runBridge(port, config) {
    var verto, bridgeInst;
    var calls = new CallStore();

    function getExtensionToCall(fsUserId) {
        var vertoCall = calls.fsUserToConf[fsUserId];
        if (vertoCall) {
            return vertoCall.ext; // we have a call for this fs user already
        }
        var ext = calls.nextExtension();
        if (calls.extToConf[ext]) {
            console.log("Extension %s is in use, finding another..", ext);
            // try to find an unoccupied extension... this will throw if we're out
            ext = calls.anyFreeExtension();
        }
        return ext;
    }

    // Create a verto instance and login, then listen on the bridge.
    verto = new VertoEndpoint(config.verto.url, config["verto-dialog-params"],
    function(msg) { // handle the incoming verto request
        switch (msg.method) {
            case "verto.answer":
                if (!msg.params || !msg.params.sdp || msg.params.callID === undefined) {
                    console.error("Missing SDP and/or CallID");
                    return;
                }
                var matrixSide;
                var exts = Object.keys(calls.extToConf);
                for (var i = 0; i < exts.length; i++) {
                    var vertoCall = calls.extToConf[exts[i]];
                    matrixSide = vertoCall.getByVertoCallId(msg.params.callID);
                    if (matrixSide) {
                        break;
                    }
                };
                if (!matrixSide) {
                    console.error("No call with ID '%s' exists.", msg.params.callID);
                    return;
                }

                // find out which user should be sending the answer
                bridgeInst.getRoomStore().getMatrixRoom(matrixSide.roomId).then(
                function(room) {
                    if (!room) {
                        throw new Error("Unknown room ID: " + matrixSide.roomId);
                    }
                    var sender = room.get("fs_user");
                    if (!sender) {
                        throw new Error("Room " + matrixSide.roomId + " has no fs_user");
                    }
                    var intent = bridgeInst.getIntent(sender);
                    return intent.sendEvent(matrixSide.roomId, "m.call.answer", {
                        call_id: matrixSide.mxCallId,
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
            case "verto.bye":
                // we HAVE to cleanup else we'll eventually fill up the ext pool
                console.log(msg, undefined, 2);
                break;
            /* TODO: Somehow get RTP dead events so we can gracefully hangup
            case "verto.event":
                if (!msg.params.pvtData) {
                    break;
                }
                verto.sendRequest("verto.subscribe", {
                    eventChannel: msg.params.pvtData.laChannel,
                    sessid: verto.sessionId
                });
                verto.sendRequest("verto.subscribe", {
                    eventChannel: msg.params.pvtData.chatChannel,
                    sessid: verto.sessionId
                });
                break; */
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
                var vertoCall, matrixSide;
                console.log(
                    "[%s] %s: from=%s in %s: %s\n",
                    request.getId(), event.type, event.user_id, event.room_id,
                    JSON.stringify(event.content)
                );
                if (context.rooms.matrix.get("fs_user")) {
                    vertoCall = calls.fsUserToConf[context.rooms.matrix.get("fs_user")];
                    if (vertoCall) {
                        matrixSide = vertoCall.getByRoomId(event.room_id);
                    }
                }

                // auto-accept invites directed to @fs_ users
                if (event.type === "m.room.member") {
                    if (event.content.membership === "invite" &&
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
                    else if (event.content.membership !== "join") {
                        // hangup if this user is in a call.
                        if (!matrixSide) {
                            request.reject("User not in a call - no hangup needed");
                            return;
                        }
                        request.outcomeFrom(verto.sendBye(vertoCall, matrixSide));
                        calls.delete(vertoCall, matrixSide);
                    }
                }
                else if (event.type === "m.call.invite") {
                    if (!vertoCall) {
                        vertoCall = new VertoCall(
                            context.rooms.matrix.get("fs_user"),
                            getExtensionToCall(context.rooms.matrix.get("fs_user"))
                        );
                    }
                    var callData = {
                        roomId: event.room_id,
                        mxUserId: event.user_id,
                        mxCallId: event.content.call_id,
                        vertoCallId: uuid.v4(),
                        offer: event.content.offer.sdp,
                        candidates: [],
                        pin: generatePin(),
                        timer: null,
                        sentInvite: false
                    };
                    vertoCall.addMatrixSide(callData);
                    calls.set(vertoCall);
                    request.outcomeFrom(
                        verto.attemptInvite(vertoCall, callData, false)
                    );
                }
                else if (event.type === "m.call.candidates") {
                    if (!matrixSide) {
                        request.reject("Received candidates for unknown call");
                        return;
                    }
                    event.content.candidates.forEach(function(cand) {
                        matrixSide.candidates.push(cand);
                    });
                    request.outcomeFrom(
                        verto.attemptInvite(vertoCall, matrixSide, false)
                    );
                }
                else if (event.type === "m.call.answer") {
                    // TODO: send verto.answer
                }
                else if (event.type === "m.call.hangup") {
                    if (!matrixSide) {
                        request.reject("Received hangup for unknown call");
                        return;
                    }
                    request.outcomeFrom(verto.sendBye(vertoCall, matrixSide));
                    calls.delete(vertoCall, matrixSide);
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

VertoEndpoint.prototype.attemptInvite = function(vertoCall, matrixSide, force) {
    if (matrixSide.candidates.length === 0) { return Promise.resolve(); }
    var self = this;

    var enoughCandidates = false;
    for (var i = 0; i < matrixSide.candidates.length; i++) {
        var c = matrixSide.candidates[i];
        if (!c.candidate) { continue; }
        // got enough candidates when SDP has a srflx or relay candidate
        if (c.candidate.indexOf("typ srflx") !== -1 ||
                c.candidate.indexOf("typ relay") !== -1) {
            enoughCandidates = true;
            console.log("Gathered enough candidates for %s", matrixSide.mxCallId);
            break; // bail early
        }
    }

    if (!enoughCandidates && !force) { // don't send the invite just yet
        if (!matrixSide.timer) {
            matrixSide.timer = setTimeout(function() {
                console.log("Timed out. Forcing invite for %s", matrixSide.mxCallId);
                self.attemptInvite(vertoCall, matrixSide, true);
            }, CANDIDATE_TIMEOUT_MS);
            console.log("Call %s is waiting for candidates...", matrixSide.mxCallId);
            return Promise.resolve("Waiting for candidates");
        }
    }

    if (matrixSide.timer) {  // cancel pending timers
        clearTimeout(matrixSide.timer);
    }
    if (matrixSide.sentInvite) {  // e.g. timed out and then got more candidates
        return Promise.resolve("Invite already sent");
    }

    // de-trickle candidates - insert the candidates in the right m= block.
    // Insert the candidate line at the *END* of the media block
    // (RFC 4566 Section 5; order is m,i,c,b,k,a) - we'll just insert at the
    // start of the a= lines for parsing simplicity)
    var mIndex = -1;
    var mType = "";
    var parsedUpToIndex = -1;
    matrixSide.offer = matrixSide.offer.split("\r\n").map(function(line) {
        if (line.indexOf("m=") === 0) { // m=audio 48202 RTP/SAVPF 111 103
            mIndex += 1;
            mType = line.split(" ")[0].replace("m=", ""); // 'audio'
            console.log("index=%s - %s", mIndex, line);
        }
        if (mIndex === -1) { return line; } // ignore session-level keys
        if (line.indexOf("a=") !== 0) { return line; } // ignore keys before a=
        if (parsedUpToIndex === mIndex) { return line; } // don't insert cands f.e a=

        matrixSide.candidates.forEach(function(cand) {
            // m-line index is more precise than the type (which can be multiple)
            // so prefer that when inserting
            if (typeof(cand.sdpMLineIndex) === "number") {
                if (cand.sdpMLineIndex !== mIndex) {
                    return;
                }
                line = "a=" + cand.candidate + "\r\n" + line;
                console.log(
                    "Inserted candidate %s at m= index %s",
                    cand.candidate, cand.sdpMLineIndex
                );
            }
            else if (cand.sdpMid !== undefined && cand.sdpMid === mType) {
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

    matrixSide.sentInvite = true;
    return this.sendRequest("verto.invite", {
        sdp: matrixSide.offer,
        dialogParams: this.getDialogParamsFor(vertoCall, matrixSide),
        sessid: this.sessionId
    });
};

VertoEndpoint.prototype.sendBye = function(vertoCall, callData) {
    return this.sendRequest("verto.bye", {
        dialogParams: this.getDialogParamsFor(vertoCall, callData),
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

VertoEndpoint.prototype.sendRequest = function(method, params) {
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

VertoEndpoint.prototype.getDialogParamsFor = function(vertoCall, callData) {
    var dialogParams = JSON.parse(JSON.stringify(this.dialogParams)); // deep copy
    dialogParams.callID = callData.vertoCallId;
    dialogParams.destination_number = vertoCall.ext;
    dialogParams.remote_caller_id_number = vertoCall.ext;
    return dialogParams;
};

// === Call Storage ===
function CallStore() {
    this.fsUserToConf = {}; // fsUserId: VertoCall
    this.extToConf = {}; // ext: VertoCall
    this.currentExtension = "00";
}

CallStore.prototype.set = function(vertoCall) {
    this.extToConf[vertoCall.ext] = vertoCall;
    this.fsUserToConf[vertoCall.fsUserId] = vertoCall;
    console.log(
        "Storing verto call on ext=%s fs_user=%s matrix_users=%s",
        vertoCall.ext, vertoCall.fsUserId, vertoCall.getNumMatrixUsers()
    );
};

CallStore.prototype.delete = function(vertoCall, matrixSide) {
    vertoCall.removeMatrixSide(matrixSide);
    if (vertoCall.getNumMatrixUsers() === 0) {
        console.log("Deleting conf call for fs_user %s", vertoCall.fsUserId);
        delete this.extToConf[vertoCall.ext];
        delete this.fsUserToConf[vertoCall.fsUserId];
    }
};

CallStore.prototype.nextExtension = function() { // loop 0-99 with leading 0
    var nextExt = parseInt(this.currentExtension) + 1;
    if (nextExt >= 100) { nextExt = 0; }
    nextExt = "" + nextExt;
    while (nextExt.length < 2) {
        nextExt = "0" + nextExt;
    }
    this.currentExtension = nextExt;
    return EXTENSION_PREFIX + nextExt;
};

CallStore.prototype.anyFreeExtension = function() {
    var ext;
    for (var i = 0; i < 100; i++) {
        var extStr = (i < 10 ? "0"+i : i+"");
        var vertoCall = this.extToConf[EXTENSION_PREFIX + extStr];
        if (!vertoCall) {
            return EXTENSION_PREFIX + extStr;
        }
    }
    throw new Error("No free extensions");
};

// Represents a single conference call
function VertoCall(fsUserId, ext) {
    this.ext = ext;
    this.fsUserId = fsUserId;
    this.mxCallsByVertoCallId = {};
    this.mxCallsByRoomId = {};
    console.log("Init verto call for fs_user %s", fsUserId);
}

VertoCall.prototype.getByRoomId = function(roomId) {
    return this.mxCallsByRoomId[roomId];
};

VertoCall.prototype.getByVertoCallId = function(callId) {
    return this.mxCallsByVertoCallId[callId];
};

VertoCall.prototype.addMatrixSide = function(data) {
    this.mxCallsByRoomId[data.roomId] = data;
    this.mxCallsByVertoCallId[data.vertoCallId] = data;
    console.log("Add matrix side for fs_user %s (%s)", this.fsUserId, data.mxUserId);
};

VertoCall.prototype.removeMatrixSide = function(data) {
    delete this.mxCallsByVertoCallId[data.vertoCallId];
    delete this.mxCallsByRoomId[data.roomId];
    console.log(
        "Removed matrix side for fs_user %s (%s)", this.fsUserId, data.mxUserId
    );
};

VertoCall.prototype.getNumMatrixUsers = function() {
    return Object.keys(this.mxCallsByRoomId).length;
};

function generatePin() {
    return Math.floor(Math.random() * 10000); // random 4-digits
}

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
