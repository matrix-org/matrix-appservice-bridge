"use strict";

/**
 * Create a store event.
 * @constructor
 * @param {string} roomId The matrix room ID
 * @param {string} eventId The matrix event ID
 * @param {string} remoteRoomId The remote room ID
 * @param {string} remoteEventId The remote event ID
 * @param {any} extras Any extra data that may be included with the event.
 */
function StoreEvent(roomId, eventId, remoteRoomId, remoteEventId, extras) {
    this.roomId = roomId;
    this.eventId = eventId;
    this.remoteRoomId = remoteRoomId;
    this.remoteEventId = remoteEventId;
    this._extras = extras || {};
}

/**
 * Get the unique ID.
 * @return {string} The room ID
 */
StoreEvent.prototype.getId = function() {
    return this.eventId + this.remoteEventId;
};

/**
 * Get the matrix room ID.
 * @return {string} The room ID
 */
StoreEvent.prototype.getMatrixRoomId = function() {
    return this.roomId;
};

/**
 * Get the matrix event ID.
 * @return {string} The event ID
 */
StoreEvent.prototype.getMatrixEventId = function() {
    return this.eventId;
};

/**
 * Get the remote room ID.
 * @return {string} The remote room ID
 */
StoreEvent.prototype.getRemoteRoomId = function() {
    return this.remoteRoomId;
};

/**
 * Get the remote event ID.
 * @return {string} The remote event ID
 */
StoreEvent.prototype.getRemoteEventId = function() {
    return this.remoteEventId;
};

/**
 * Get the data value for the given key.
 * @param {string} key An arbitrary bridge-specific key.
 * @return {*} Stored data for this key. May be undefined.
 */
StoreEvent.prototype.get = function(key) {
    return this._extras[key];
};

/**
 * Set an arbitrary bridge-specific data value for this room. This will be serailized
 * under an 'extras' key.
 * @param {string} key The key to store the data value under.
 * @param {*} val The data value. This value should be serializable via
 * <code>JSON.stringify(data)</code>.
 */
StoreEvent.prototype.set = function(key, val) {
    this._extras[key] = val;
};

/**
 * Serialize data about this room into a JSON object.
 * @return {Object} The serialised data
 */
StoreEvent.prototype.serialize = function() {
    return {
        id: event.getId(),
        matrix: {
            roomId: this.roomId,
            eventId: this.eventId,
        },
        remote: {
            roomId: this.remoteRoomId,
            eventId: this.remoteEventId,
        },
        extras: this._extras,
    };
};

/**
 * Set data about this room from a serialized data object.
 * @param {Object} data The serialized data
 */
StoreEvent.deserialize = function(data) {
    this.roomId = data.matrix.roomId;
    this.eventId = data.matrix.eventId;
    this.remoteRoomId = data.remote.roomId;
    this.remoteEventId = data.remote.eventId;
    this._extras = data.extras;
};

module.exports = StoreEvent;
