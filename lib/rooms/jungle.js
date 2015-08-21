"use strict";

/**
 * Create a jungle room.
 * @constructor
 * @param {string} identifier The ID for this room
 * @param {Object=} data The key-value data object to assign to this room.
 */
function JungleRoom(identifier, data) {
    this.roomId = identifier;
    this.data = data || {};
}

/**
 * Get the room ID.
 * @return {string} The room ID
 */
JungleRoom.prototype.getId = function() {
    return this.roomId;
};

/**
 * Serialize all the data about this room, excluding the room ID.
 * @return {Object} The serialised data
 */
JungleRoom.prototype.getData = function() {
    return this.data;
}

/**
 * Get the data value for the given key.
 * @param {string} key An arbitrary bridge-specific key.
 * @return {*} Stored data for this key. May be undefined.
 */
JungleRoom.prototype.get = function(key) {
    return this.data[key];
};

/**
 * Set an arbitrary bridge-specific data value for this room.
 * @param {string} key The key to store the data value under.
 * @param {*} val The data value. This value should be serializable via
 * <code>JSON.stringify(data)</code>.
 */
JungleRoom.prototype.set = function(key, val) {
    this.data[key] = val;
};

/** The JungleRoom class. */
module.exports = JungleRoom;
