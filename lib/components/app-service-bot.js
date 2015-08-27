"use strict";

/**
 * Construct an AS bot user which has various helper methods.
 * @constructor
 * @param {MatrixClient} client The client instance configured for the AS bot.
 * @param {AppServiceRegistration} registration The registration that the bot
 * is following. Used to determine which user IDs it is controlling.
 */
function AppServiceBot(client, registration) {
    this.client = client;
    this.registration = registration.getOutput();
    var self = this;
    // yank out the exclusive user ID regex strings
    this.exclusiveUserRegexes = [];
    if (this.registration.namespaces && this.registration.namespaces.users) {
        this.registration.namespaces.users.forEach(function(userEntry) {
            if (!userEntry.exclusive) {
                return;
            }
            self.exclusiveUserRegexes.push(userEntry.regex);
        });
    }
}

AppServiceBot.prototype.getClient = function() {
    return this.client;
};

AppServiceBot.prototype.getUserId = function() {
    return this.client.credentials.userId;
};

/**
 * Get the membership lists of every room the AS bot is in. This does an
 * initial sync.
 * @return {Promise} Resolves to a dict of room_id: {@link AppServiceBot~RoomInfo}.
 */
AppServiceBot.prototype.getMemberLists = function() {
    var self = this;
    return this.client._http.authedRequest(
        undefined, "GET", "/initialSync", {limit: 0}
    ).then(function(res) {
        var rooms = res.rooms || [];
        return rooms.map(function(room) {
            return self._getRoomInfo(room.room_id, room.state);
        });
    });
};

AppServiceBot.prototype._getRoomInfo = function(roomId, stateEvents) {
    var self = this;
    stateEvents = stateEvents || [];
    var roomInfo = {
        id: roomId,
        state: stateEvents,
        realJoinedUsers: [],
        remoteJoinedUsers: []
    };
    stateEvents.forEach(function(event) {
        if (event.type !== "m.room.member" || event.content.membership !== "join") {
            return;
        }
        var userId = event.state_key;
        if (userId === self.getUserId()) {
            return;
        }
        if (self._isRemoteUser(roomId, userId)) {
            roomInfo.remoteJoinedUsers.push(userId);
        }
        else {
            roomInfo.realJoinedUsers.push(userId);
        }
    });
    return roomInfo;
}

AppServiceBot.prototype._isRemoteUser = function(roomId, userId) {
    for (var i = 0; i < this.exclusiveUserRegexes.length; i++) {
        var regex = new RegExp(this.exclusiveUserRegexes[i]);
        if (regex.test(userId)) {
            return true;
        }
    }
    return false;
};

module.exports = AppServiceBot;

/**
 * @typedef AppServiceBot~RoomInfo
 * @type {Object}
 * @property {string} id The matrix room ID
 * @property {Object[]} state The raw state events for this room
 * @property {string[]} realJoinedUsers A list of user IDs of real matrix users
 * that have joined this room.
 * @property {string[]} remoteJoinedUsers A list of user IDs of remote users
 * (provisioned by the AS) that have joined this room.
 */
