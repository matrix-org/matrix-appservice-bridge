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
 * Serialize data about this room into a JSON object.
 * @return {Object} The serialised data
 */
MatrixRoom.prototype.serialize = function() {
    return {
        name: this.name,
        topic: this.topic
    };
};

/**
 * Set data about this room from a serialized data object.
 * @param {Object} data The serialized data
 */
MatrixRoom.prototype.deserialize = function(data) {
    this.name = data.name;
    this.topic = data.topic;
};

/** The MatrixRoom class. */
module.exports = MatrixRoom;
