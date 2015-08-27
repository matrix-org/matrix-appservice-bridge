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
    this.registration = registration;
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
