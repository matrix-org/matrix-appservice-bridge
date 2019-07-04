/*
Copyright 2019 The Matrix.org Foundation C.I.C.
Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at
    http://www.apache.org/licenses/LICENSE-2.0
Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

/**
 * Create a store event.
 * @constructor
 * @param {string} roomId The matrix room ID
 * @param {string} eventId The matrix event ID
 * @param {string} remoteRoomId The remote room ID
 * @param {string} remoteEventId The remote event ID
 * @param {any} extras Any extra data that may be included with the event.
 */
function StoredEvent(roomId, eventId, remoteRoomId, remoteEventId, extras) {
    this.roomId = roomId;
    this.eventId = eventId;
    this.remoteRoomId = remoteRoomId;
    this.remoteEventId = remoteEventId;
    this._extras = extras || {};
}

/**
 * Get the unique ID.
 * @return {string} A unique ID
 */
StoredEvent.prototype.getId = function() {
    return this.eventId + this.remoteEventId;
};

/**
 * Get the matrix room ID.
 * @return {string} The room ID
 */
StoredEvent.prototype.getMatrixRoomId = function() {
    return this.roomId;
};

/**
 * Get the matrix event ID.
 * @return {string} The event ID
 */
StoredEvent.prototype.getMatrixEventId = function() {
    return this.eventId;
};

/**
 * Get the remote room ID.
 * @return {string} The remote room ID
 */
StoredEvent.prototype.getRemoteRoomId = function() {
    return this.remoteRoomId;
};

/**
 * Get the remote event ID.
 * @return {string} The remote event ID
 */
StoredEvent.prototype.getRemoteEventId = function() {
    return this.remoteEventId;
};

/**
 * Get the data value for the given key.
 * @param {string} key An arbitrary bridge-specific key.
 * @return {*} Stored data for this key. May be undefined.
 */
StoredEvent.prototype.get = function(key) {
    return this._extras[key];
};

/**
 * Set an arbitrary bridge-specific data value for this event. This will be serailized
 * under an 'extras' key.
 * @param {string} key The key to store the data value under.
 * @param {*} val The data value. This value should be serializable via
 * <code>JSON.stringify(data)</code>.
 */
StoredEvent.prototype.set = function(key, val) {
    this._extras[key] = val;
};

/**
 * Serialize data about this event into a JSON object.
 * @return {Object} The serialised data
 */
StoredEvent.prototype.serialize = function() {
    return {
        id: this.getId(),
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
 * Set data about this event from a serialized data object.
 * @param {Object} data The serialized data
 */
StoredEvent.deserialize = function(data) {
    return new StoredEvent(
        data.matrix.roomId,
        data.matrix.eventId,
        data.remote.roomId,
        data.remote.eventId,
        data.extras
    );
};

module.exports = StoredEvent;
