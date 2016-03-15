"use strict";

/**
 * Create a matrix room.
 * @constructor
 * @param {string} roomId The room ID
 */
function MatrixRoom(roomId, data) {
    this.roomId = roomId;
    this._extras = {};
    if (data) {
        this.deserialize(data);
    }
}

/**
 * Get the room ID.
 * @return {string} The room ID
 */
MatrixRoom.prototype.getId = function() {
    return this.roomId;
};

/**
 * Get the data value for the given key.
 * @param {string} key An arbitrary bridge-specific key.
 * @return {*} Stored data for this key. May be undefined.
 */
MatrixRoom.prototype.get = function(key) {
    return this._extras[key];
};

/**
 * Set an arbitrary bridge-specific data value for this room. This will be serailized
 * under an 'extras' key.
 * @param {string} key The key to store the data value under.
 * @param {*} val The data value. This value should be serializable via
 * <code>JSON.stringify(data)</code>.
 */
MatrixRoom.prototype.set = function(key, val) {
    this._extras[key] = val;
};

/**
 * Serialize data about this room into a JSON object.
 * @return {Object} The serialised data
 */
MatrixRoom.prototype.serialize = function() {
    return {
        name: this.name,
        topic: this.topic,
        extras: this._extras
    };
};

/**
 * Set data about this room from a serialized data object.
 * @param {Object} data The serialized data
 */
MatrixRoom.prototype.deserialize = function(data) {
    this.name = data.name;
    this.topic = data.topic;
    this._extras = data.extras;
};

/** The MatrixRoom class. */
module.exports = MatrixRoom;
