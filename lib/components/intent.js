"use strict";
var Promise = require("bluebird");
var MatrixUser = require("../models/users/matrix");
var MatrixEvent = require("matrix-js-sdk").MatrixEvent;
var RoomMember = require("matrix-js-sdk").RoomMember;

var STATE_EVENT_TYPES = [
    "m.room.name", "m.room.topic", "m.room.power_levels", "m.room.member",
    "m.room.join_rules", "m.room.history_visibility"
];

/**
 * Create an entity which can fulfil the intent of a given user.
 * @constructor
 * @param {MatrixClient} client The matrix client instance whose intent is being
 * fulfilled e.g. the entity joining the room when you call intent.join(roomId).
 * @param {MatrixClient} botClient The client instance for the AS bot itself.
 * This will be used to perform more priveleged actions such as creating new
 * rooms, sending invites, etc.
 * @param {Object} opts Options for this Intent instance.
 * @param {boolean} opts.registered True to inform this instance that the client
 * is already registered. No registration requests will be made from this Intent.
 * Default: false.
 * @param {boolean} opts.dontCheckPowerLevel True to not check for the right power
 * level before sending events. Default: false.
 */
function Intent(client, botClient, opts) {
    this.client = client;
    this.botClient = botClient;
    this._membershipStates = {
    //  room_id : "join|invite|leave|null"   null=unknown
    };
    this._powerLevels = {
    //  room_id: event.content
    };
    this.opts = opts || {};
}

/**
 * Return the client this Intent is acting on behalf of.
 * @return {MatrixClient} The client
 */
Intent.prototype.getClient = function() {
    return this.client;
};

/**
 * <p>Send a plaintext message to a room.</p>
 * This will automatically make the client join the room so they can send the
 * message if they are not already joined. It will also make sure that the client
 * has sufficient power level to do this.
 * @param {string} roomId The room to send to.
 * @param {string} text The text string to send.
 * @return {Promise}
 */
Intent.prototype.sendText = function(roomId, text) {
    return this.sendMessage(roomId, {
        body: text,
        msgtype: "m.text"
    });
};

/**
 * <p>Set the name of a room.</p>
 * This will automatically make the client join the room so they can set the
 * name if they are not already joined. It will also make sure that the client
 * has sufficient power level to do this.
 * @param {string} roomId The room to send to.
 * @param {string} name The room name.
 * @return {Promise}
 */
Intent.prototype.setRoomName = function(roomId, name) {
    return this.sendStateEvent(roomId, "m.room.name", "", {
        name: name
    });
};

/**
 * <p>Set the topic of a room.</p>
 * This will automatically make the client join the room so they can set the
 * topic if they are not already joined. It will also make sure that the client
 * has sufficient power level to do this.
 * @param {string} roomId The room to send to.
 * @param {string} topic The room topic.
 * @return {Promise}
 */
Intent.prototype.setRoomTopic = function(roomId, topic) {
    return this.sendStateEvent(roomId, "m.room.topic", "", {
        topic: topic
    });
};

/**
 * <p>Set the avatar of a room.</p>
 * This will automatically make the client join the room so they can set the
 * topic if they are not already joined. It will also make sure that the client
 * has sufficient power level to do this.
 * @param {string} roomId The room to send to.
 * @param {string} avatar The url of the avatar.
 * @param {string} info Extra information about the image. See m.room.avatar for details.
 * @return {Promise}
 */
Intent.prototype.setRoomAvatar = function(roomId, avatar, info) {
    var content = {
        url: avatar
    };
    if (info) {
        content.info = info;
    }
    return this.sendStateEvent(roomId, "m.room.avatar", "", content);
};

/**
 * <p>Send a typing event to a room.</p>
 * This will automatically make the client join the room so they can send the
 * typing event if they are not already joined.
 * @param {string} roomId The room to send to.
 * @param {boolean} isTyping True if typing
 * @return {Promise}
 */
Intent.prototype.sendTyping = function(roomId, isTyping) {
    var self = this;
    return self._ensureJoined(roomId).then(function() {
        return self._ensureHasPowerLevelFor(roomId, "m.typing");
    }).then(function() {
        return self.client.sendTyping(roomId, isTyping);
    });
};

/**
 * <p>Send a read receipt to a room.</p>
 * This will automatically make the client join the room so they can send the
 * receipt event if they are not already joined.
 * @param{string} roomId The room to send to.
 * @param{string} eventId The event ID to set the receipt mark to.
 * @return {Promise}
 */
Intent.prototype.sendReadReceipt = function(roomId, eventId) {
    var self = this;
    var event = new MatrixEvent({
        room_id: roomId,
        event_id: eventId,
    });
    return self._ensureJoined(roomId).then(function() {
        return self.client.sendReadReceipt(event);
    });
}

/**
 * Set the power level of the given target.
 * @param {string} roomId The room to set the power level in.
 * @param {string} target The target user ID
 * @param {number} level The desired level
 * @return {Promise}
 */
Intent.prototype.setPowerLevel = function(roomId, target, level) {
    var self = this;
    return self._ensureJoined(roomId).then(function() {
        return self._ensureHasPowerLevelFor(roomId, "m.room.power_levels");
    }).then(function(event) {
        return self.client.setPowerLevel(roomId, target, level, event);
    });
};

/**
 * <p>Send an <code>m.room.message</code> event to a room.</p>
 * This will automatically make the client join the room so they can send the
 * message if they are not already joined. It will also make sure that the client
 * has sufficient power level to do this.
 * @param {string} roomId The room to send to.
 * @param {Object} content The event content
 * @return {Promise}
 */
Intent.prototype.sendMessage = function(roomId, content) {
    return this.sendEvent(roomId, "m.room.message", content);
};

/**
 * <p>Send a message event to a room.</p>
 * This will automatically make the client join the room so they can send the
 * message if they are not already joined. It will also make sure that the client
 * has sufficient power level to do this.
 * @param {string} roomId The room to send to.
 * @param {string} type The event type
 * @param {Object} content The event content
 * @return {Promise}
 */
Intent.prototype.sendEvent = function(roomId, type, content) {
    var self = this;
    return self._ensureJoined(roomId).then(function() {
        return self._ensureHasPowerLevelFor(roomId, type);
    }).then(self._joinGuard(roomId, function() {
        return self.client.sendEvent(roomId, type, content);
    }));
};

/**
 * <p>Send a state event to a room.</p>
 * This will automatically make the client join the room so they can send the
 * state if they are not already joined. It will also make sure that the client
 * has sufficient power level to do this.
 * @param {string} roomId The room to send to.
 * @param {string} type The event type
 * @param {string} skey The state key
 * @param {Object} content The event content
 * @return {Promise}
 */
Intent.prototype.sendStateEvent = function(roomId, type, skey, content) {
    var self = this;
    return self._ensureJoined(roomId).then(function() {
        return self._ensureHasPowerLevelFor(roomId, type);
    }).then(self._joinGuard(roomId, function() {
        return self.client.sendStateEvent(roomId, type, content, skey);
    }));
};

/**
 * <p>Get the current room state for a room.</p>
 * This will automatically make the client join the room so they can get the
 * state if they are not already joined.
 * @param {string} roomId The room to get the state from.
 * @return {Promise}
 */
Intent.prototype.roomState = function(roomId) {
    var self = this;
    return self._ensureJoined(roomId).then(function() {
        return self.client.roomState(roomId);
    });
};

/**
 * Create a room with a set of options.
 * @param {Object} opts Options.
 * @param {boolean} opts.createAsClient True to create this room as a client and
 * not the bot: the bot will not join. False to create this room as the bot and
 * auto-join the client. Default: false.
 * @param {Object} opts.options Options to pass to the client SDK /createRoom API.
 * @return {Promise}
 */
Intent.prototype.createRoom = function(opts) {
    var self = this;
    var cli = opts.createAsClient ? this.client : this.botClient;
    var options = opts.options || {};
    if (!opts.createAsClient) {
        // invite the client if they aren't already
        options.invite = options.invite || [];
        if (options.invite.indexOf(this.client.credentials.userId) === -1) {
            options.invite.push(this.client.credentials.userId);
        }
    }
    // make sure that the thing doing the room creation isn't inviting itself
    // else Synapse hard fails the operation with M_FORBIDDEN
    if (options.invite && options.invite.indexOf(cli.credentials.userId) !== -1) {
        options.invite.splice(options.invite.indexOf(cli.credentials.userId), 1);
    }

    return this._ensureRegistered().then(function() {
        return cli.createRoom(options);
    }).then(function(res) {
        // create a fake power level event to give the room creator ops if we
        // don't yet have a power level event.
        if (self._powerLevels[res.room_id]) {
            return res;
        }
        self._powerLevels[res.room_id] = {
            users_default: 0,
            events_default: 0,
            state_default: 50,
            users: {},
            events: {}
        };
        self._powerLevels[res.room_id].users[cli.credentials.userId] = 100;
        return res;
    });
};

/**
 * <p>Invite a user to a room.</p>
 * This will automatically make the client join the room so they can send the
 * invite if they are not already joined.
 * @param {string} roomId The room to invite the user to.
 * @param {string} target The user ID to invite.
 * @return {Promise} Resolved when invited, else rejected with an error.
 */
Intent.prototype.invite = function(roomId, target) {
    var self = this;
    return this._ensureJoined(roomId).then(function() {
        return self.client.invite(roomId, target);
    });
};

/**
 * <p>Kick a user from a room.</p>
 * This will automatically make the client join the room so they can send the
 * kick if they are not already joined.
 * @param {string} roomId The room to kick the user from.
 * @param {string} target The target of the kick operation.
 * @param {string} reason Optional. The reason for the kick.
 * @return {Promise} Resolved when kickked, else rejected with an error.
 */
Intent.prototype.kick = function(roomId, target, reason) {
    var self = this;
    return this._ensureJoined(roomId).then(function() {
        return self.client.kick(roomId, target, reason);
    });
};

/**
 * <p>Ban a user from a room.</p>
 * This will automatically make the client join the room so they can send the
 * ban if they are not already joined.
 * @param {string} roomId The room to ban the user from.
 * @param {string} target The target of the ban operation.
 * @param {string} reason Optional. The reason for the ban.
 * @return {Promise} Resolved when banned, else rejected with an error.
 */
Intent.prototype.ban = function(roomId, target, reason) {
    var self = this;
    return this._ensureJoined(roomId).then(function() {
        return self.client.ban(roomId, target, reason);
    });
};

/**
 * <p>Unban a user from a room.</p>
 * This will automatically make the client join the room so they can send the
 * unban if they are not already joined.
 * @param {string} roomId The room to unban the user from.
 * @param {string} target The target of the unban operation.
 * @return {Promise} Resolved when unbanned, else rejected with an error.
 */
Intent.prototype.unban = function(roomId, target) {
    var self = this;
    return this._ensureJoined(roomId).then(function() {
        return self.client.unban(roomId, target);
    });
};

/**
 * <p>Join a room</p>
 * This will automatically send an invite from the bot if it is an invite-only
 * room, which may make the bot attempt to join the room if it isn't already.
 * @param {string} roomId The room to join.
 * @return {Promise}
 */
Intent.prototype.join = function(roomId) {
    return this._ensureJoined(roomId);
};

/**
 * <p>Leave a room</p>
 * This will no-op if the user isn't in the room.
 * @param {string} roomId The room to leave.
 * @return {Promise}
 */
Intent.prototype.leave = function(roomId) {
    return this.client.leave(roomId);
};

/**
 * <p>Get a user's profile information</p>
 * @param {string} userId The ID of the user whose profile to return
 * @param {string} info The profile field name to retrieve (e.g. 'displayname'
 * or 'avatar_url'), or null to fetch the entire profile information.
 * @return {Promise} A Promise that resolves with the requested user's profile
 * information
 */
Intent.prototype.getProfileInfo = function(userId, info) {
    var self = this;
    return self._ensureRegistered().then(function() {
        return self.client.getProfileInfo(userId, info);
    });
};

/**
 * <p>Set the user's display name</p>
 * @param {string} name The new display name
 * @return {Promise}
 */
Intent.prototype.setDisplayName = function(name) {
    var self = this;
    return self._ensureRegistered().then(function() {
        return self.client.setDisplayName(name);
    });
};

/**
 * <p>Set the user's avatar URL</p>
 * @param {string} url The new avatar URL
 * @return {Promise}
 */
Intent.prototype.setAvatarUrl = function(url) {
    var self = this;
    return self._ensureRegistered().then(function() {
        return self.client.setAvatarUrl(url);
    });
};

/**
 * Create a new alias mapping.
 * @param {string} alias The room alias to create
 * @param {string} roomId The room ID the alias should point at.
 * @return {Promise}
 */
Intent.prototype.createAlias = function(alias, roomId) {
    var self = this;
    return self._ensureRegistered().then(function() {
        return self.client.createAlias(alias, roomId);
    });
};

/**
 * Inform this Intent class of an incoming event. Various optimisations will be
 * done if this is provided. For example, a /join request won't be sent out if
 * it knows you've already been joined to the room.
 * @param {Object} event The incoming event JSON
 */
Intent.prototype.onEvent = function(event) {
    if (event.type === "m.room.member" &&
            event.state_key === this.client.credentials.userId) {
        this._membershipStates[event.room_id] = event.content.membership;
    }
    else if (event.type === "m.room.power_levels") {
        this._powerLevels[event.room_id] = event.content;
    }
};

// Guard a function which returns a promise which may reject if the user is not
// in the room. If the promise rejects, join the room and retry the function.
Intent.prototype._joinGuard = function(roomId, promiseFn) {
    var self = this;
    return function() {
        return promiseFn().catch(function(err) {
            if (err.errcode !== "M_FORBIDDEN") {
                // not a guardable error
                throw err;
            }
            return self._ensureJoined(roomId, true).then(function() {
                return promiseFn();
            })
        });
    };
};

Intent.prototype._ensureJoined = function(roomId, ignoreCache) {
    if (this._membershipStates[roomId] === "join" && !ignoreCache) {
        return Promise.resolve();
    }

    /* Logic:
    if client /join:
      SUCCESS
    else if bot /invite client:
      if client /join:
        SUCCESS
      else:
        FAIL (client couldn't join)
    else if bot /join:
      if bot /invite client and client /join:
        SUCCESS
      else:
        FAIL (bot couldn't invite)
    else:
      FAIL (bot can't get into the room)
    */
    var self = this;
    var d = new Promise.defer();
    var userId = self.client.credentials.userId;
    function mark(r, state) {
        self._membershipStates[r] = state;
        if (state === "join") {
            d.resolve();
        }
    }

    self._ensureRegistered().done(function() {
        self.client.joinRoom(roomId, { syncRoom: false }).then(function() {
            mark(roomId, "join");
        }, function(e) {
            if (e.errcode !== "M_FORBIDDEN") {
                d.reject(new Error("Failed to join room"));
                return;
            }
            // Try bot inviting client
            self.botClient.invite(roomId, userId).then(function() {
                return self.client.joinRoom(roomId, { syncRoom: false });
            }).done(function() {
                mark(roomId, "join");
            }, function(invErr) {
                // Try bot joining
                self.botClient.joinRoom(roomId, { syncRoom: false }).then(function() {
                    return self.botClient.invite(roomId, userId);
                }).then(function() {
                    return self.client.joinRoom(roomId, { syncRoom: false });
                }).done(function() {
                    mark(roomId, "join");
                }, function(finalErr) {
                    d.reject(new Error("Failed to join room"));
                    return;
                });
            });
        });
    }, function(e) {
        d.reject(e);
    });

    return d.promise;
};

Intent.prototype._ensureHasPowerLevelFor = function(roomId, eventType) {
    if (this.opts.dontCheckPowerLevel && eventType !== "m.room.power_levels") {
        return Promise.resolve();
    }
    var self = this;
    var userId = this.client.credentials.userId;
    var promise = Promise.resolve(this._powerLevels[roomId]);
    if (!this._powerLevels[roomId]) {
        promise = this.client.getStateEvent(roomId, "m.room.power_levels", "");
    }
    return promise.then(function(eventContent) {
        self._powerLevels[roomId] = eventContent;
        var event = {
            content: eventContent,
            room_id: roomId,
            user_id: "",
            event_id: "_",
            state_key: "",
            type: "m.room.power_levels"
        }
        var powerLevelEvent = new MatrixEvent(event);
        // What level do we need for this event type?
        var defaultLevel = event.content.events_default;
        if (STATE_EVENT_TYPES.indexOf(eventType) !== -1) {
            defaultLevel = event.content.state_default;
        }
        var requiredLevel = event.content.events[eventType] || defaultLevel;

        // Parse out what level the client has by abusing the JS SDK
        var roomMember = new RoomMember(roomId, userId);
        roomMember.setPowerLevelEvent(powerLevelEvent);

        if (requiredLevel > roomMember.powerLevel) {
            // can the bot update our power level?
            var bot = new RoomMember(roomId, self.botClient.credentials.userId);
            bot.setPowerLevelEvent(powerLevelEvent);
            var levelRequiredToModifyPowerLevels = event.content.events[
                "m.room.power_levels"
            ] || event.content.state_default;
            if (levelRequiredToModifyPowerLevels > bot.powerLevel) {
                // even the bot has no power here.. give up.
                throw new Error(
                    "Cannot ensure client has power level for event " + eventType +
                    " : client has " + roomMember.powerLevel + " and we require " +
                    requiredLevel + " and the bot doesn't have permission to " +
                    "edit the client's power level."
                );
            }
            // update the client's power level first
            return self.botClient.setPowerLevel(
                roomId, userId, requiredLevel, powerLevelEvent
            ).then(function() {
                // tweak the level for the client to reflect the new reality
                var userLevels = powerLevelEvent.getContent().users || {};
                userLevels[userId] = requiredLevel;
                powerLevelEvent.getContent().users = userLevels;
                return Promise.resolve(powerLevelEvent);
            });
        }
        return Promise.resolve(powerLevelEvent);
    });
};

Intent.prototype._ensureRegistered = function() {
    if (this.opts.registered) {
        return Promise.resolve("registered=true");
    }
    var self = this;
    var userId = self.client.credentials.userId;
    var localpart = new MatrixUser(userId).localpart;
    return self.botClient.register(localpart).then(function(res) {
        self.opts.registered = true;
        return res;
    }, function(err) {
        if (err.errcode === "M_USER_IN_USE") {
            self.opts.registered = true;
            return err;
        }
    });
};

module.exports = Intent;
