"use strict";

/**
 * Construct an AS bot user which has various helper methods.
 * @constructor
 * @param {MatrixClient} client The client instance configured for the AS bot.
 * @param {AppServiceRegistration} registration The registration that the bot
 * is following. Used to determine which user IDs it is controlling.
 * @param {MembershipCache} memberCache The bridges membership cache instance,
 * for storing membership the bot has discovered.
 */
function AppServiceBot(client, registration, memberCache) {
    this.client = client;
    this.registration = registration.getOutput();
    this.memberCache = memberCache;
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
    return this.client.getJoinedRooms().then((res) => {
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
    this.client.getJoinedRoomMembers().then((res) => {
        if (!res.joined) {
            return {};
        }
        for (const member in res.joined) {
            if (this.isRemoteUser(member)) {
                this.memberCache.setMemberEntry(roomId, member, "join");
            }
        }
        return res.joined;
    });
};

/**
 * @deprecated
 * @throws {Error} This will always throw because /sync is no longer supported.
 */
AppServiceBot.prototype.getMemberLists = function() {
    throw new Error(
        "The appservice bot can no longer /sync because this functionality was removed." +
        "Please use getJoinedRooms and getJoinedMembers"
    );
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
        if (self.isRemoteUser(userId)) {
            roomInfo.remoteJoinedUsers.push(userId);
        }
        else {
            roomInfo.realJoinedUsers.push(userId);
        }
    });
    return roomInfo;
}

/**
 * Test a userId to determine if it's a user within the exclusive regexes of the bridge.
 * @return {boolean} True if it is a remote user, false otherwise.
 */
AppServiceBot.prototype.isRemoteUser = function(userId) {
    for (var i = 0; i < this.exclusiveUserRegexes.length; i++) {
        var regex = new RegExp(this.exclusiveUserRegexes[i]);
        if (regex.test(userId)) {
            return true;
        }
    }
    return false;
};

// Backwards compatible for many bridges that make use of _isRemoteUser
AppServiceBot.prototype._isRemoteUser = AppServiceBot.prototype.isRemoteUser;

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
