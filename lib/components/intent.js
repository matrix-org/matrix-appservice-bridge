"use strict";
var Promise = require("bluebird");

/**
 * Create an entity which can fulfil the intent of a given user.
 * @constructor
 * @param {MatrixClient} client The matrix client instance whose intent is being
 * fulfilled e.g. the entity joining the room when you call intent.join(roomId).
 * @param {MatrixClient} botClient The client instance for the AS bot itself.
 * This will be used to perform more priveleged actions such as creating new
 * rooms, sending invites, etc.
 */
function Intent(client, botClient) {
    this.client = client;
    this.botClient = botClient;
}

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
    }).then(function() {
        return self.client.sendEvent(roomId, type, content);
    });
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
    }).then(function() {
        return self.client.sendStateEvent(roomId, type, content, skey);
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
    var cli = opts.createAsClient ? this.client : this.botClient;
    var options = opts.options || {};
    if (!opts.createAsClient) {
        // invite the client
        options.invite = options.invite || [];
        options.invite.push(this.client.credentials.userId);
    }
    return cli.createRoom(options);
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
 * <p>Set the user's display name</p>
 * @param {string} name The new display name
 * @return {Promise}
 */
Intent.prototype.setDisplayName = function(name) {
    return this.client.setDisplayName(name);
};

/**
 * <p>Set the user's avatar URL</p>
 * @param {string} url The new avatar URL
 * @return {Promise}
 */
Intent.prototype.setAvatarUrl = function(url) {
    return this.client.setAvatarUrl(url);
};


Intent.prototype._ensureJoined = function(roomId) {
    /*
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
    return Promise.resolve();
};

Intent.prototype._ensureHasPowerLevelFor = function(roomId, eventType) {
    // get m.room.power_levels event. Parse it (abuse JS SDK?)
    // send modified power_levels if necessary.
    // return MatrixEvent of m.room.power_levels
};

module.exports = Intent;
