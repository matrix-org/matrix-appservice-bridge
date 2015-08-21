"use strict";

/**
 * Create a matrix room.
 * @constructor
 * @param {string} roomId The room ID
 */
function MatrixRoom(roomId) {
    this.roomId = roomId;
}

/**
 * Get the room ID.
 * @return {string} The room ID
 */
MatrixRoom.prototype.getId = function() {
    return this.roomId;
};

/**
 * Set data about this room from a serialised data object.
 * @param {Object} data The serialised data
 */
MatrixRoom.prototype.setData = function(data) {
    this.name = data.name;
    this.topic = data.topic;
};

/** The MatrixRoom class. */
module.exports = MatrixRoom;
