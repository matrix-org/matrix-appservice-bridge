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
 * Get a list of joined room IDs for the AS bot.
 * @return {Promise<string[],Error>} Resolves to a list of room IDs.
 */
AppServiceBot.prototype.getJoinedRooms = function() {
    return this.client._http.authedRequestWithPrefix(
        undefined, "GET", "/joined_rooms", undefined, undefined, "/_matrix/client/r0"
    ).then(function(res) {
        if (!res.joined_rooms) {
            return [];
        }
        return res.joined_rooms;
    });
};

/**
 * Get a map of joined user IDs for the given room ID. The values in the map are objects
 * with a 'display_name' and 'avatar_url' properties. These properties may be null.
 * @param {string} roomId The room to get a list of joined user IDs in.
 * @return {Promise<Object,Error>} Resolves to a map of user ID => display_name avatar_url
 */
AppServiceBot.prototype.getJoinedMembers = function(roomId) {
    return this.client._http.authedRequestWithPrefix(
        undefined, "GET", "/rooms/" + encodeURIComponent(roomId) + "/joined_members",
        undefined, undefined, "/_matrix/client/r0"
    ).then(function(res) {
        if (!res.joined) {
            return {};
        }
        return res.joined;
    });
};

/**
 * Get the membership lists of every room the AS bot is in. This does a /sync.
 * @return {Promise} Resolves to a dict of room_id: {@link AppServiceBot~RoomInfo}.
 */
AppServiceBot.prototype.getMemberLists = function() {
    var self = this;
    var filterJson = JSON.stringify({
        event_fields: ["content.membership", "type", "state_key"],
        presence: {
            not_types:["*"]
        },
        room: {
            timeline: { limit: 0 },
            ephemeral: { not_types: ["*"] },
            state: { types: ["m.room.member"] }
        }
    });
    return this.client._http.authedRequestWithPrefix(
        undefined, "GET", "/sync", {filter: filterJson}, undefined, "/_matrix/client/r0"
    ).then(function(res) {
        var rooms = res.rooms || {};
        var roomIdToRoom = rooms.join || {};
        var dict = {};
        Object.keys(roomIdToRoom).forEach(function(roomId) {
            dict[roomId] = self._getRoomInfo(roomId, roomIdToRoom[roomId]);
        })
        return dict;
    });
};

AppServiceBot.prototype._getRoomInfo = function(roomId, joinedRoom) {
    var self = this;
    var stateEvents = joinedRoom.state ? joinedRoom.state.events : [];
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
