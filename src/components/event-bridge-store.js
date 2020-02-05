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

const BridgeStore = require("./bridge-store");
const StoredEvent = require("../models/events/event");
const util = require("util");

/**
 * Construct a store suitable for event mapping information. Data is stored
 * as {@link StoredEvent}s.
 * @constructor
 * @param {Datastore} db The connected NEDB database instance
 */
function EventBridgeStore(db) {
    this.db = db;
}

util.inherits(EventBridgeStore, BridgeStore);

/**
 * Insert an event, clobbering based on the ID of the StoredEvent.
 * @param {StoredEvent} event
 * @return {Promise}
 */
EventBridgeStore.prototype.upsertEvent = function(event) {
    return this.upsert({
        id: event.getId()
    }, event.serialize());
}

/**
 * Get an existing event based on the provided matrix IDs.
 * @param {string} roomId The ID of the room.
 * @param {string} eventId The ID of the event.
 * @return {?StoredEvent} A promise which resolves to the StoredEvent or null.
 */
EventBridgeStore.prototype.getEntryByMatrixId = function(roomId, eventId) {
    return this.selectOne({
        "matrix.roomId": roomId,
        "matrix.eventId": eventId,
    }, this.convertTo(function(doc) {
        return StoredEvent.deserialize(doc);
    }));
}

/**
 * Get an existing event based on the provided remote IDs.
 * @param {string} roomId The ID of the room.
 * @param {string} eventId The ID of the event.
 * @return {?StoredEvent} A promise which resolves to the StoredEvent or null.
 */
EventBridgeStore.prototype.getEntryByRemoteId = function(roomId, eventId) {
    return this.selectOne({
        "remote.roomId": roomId,
        "remote.eventId": eventId,
    }, this.convertTo(function(doc) {
        return StoredEvent.deserialize(doc);
    }));
}

/**
 * Remove entries based on the event data.
 * @param {StoredEvent} event The event to remove.
 * @return {Promise}
 */
EventBridgeStore.prototype.removeEvent = function(event) {
    return this.delete({
        id: event.getId(),
    });
};

/**
 * Remove entries based on the matrix IDs.
 * @param {string} roomId The ID of the room.
 * @param {string} eventId The ID of the event.
 * @return {Promise}
 */
EventBridgeStore.prototype.removeEventByMatrixId = function(roomId, eventId) {
    return this.delete({
        "matrix.roomId": roomId,
        "matrix.eventId": eventId,
    });
};

/**
 * Remove entries based on the matrix IDs.
 * @param {string} roomId The ID of the room.
 * @param {string} eventId The ID of the event.
 * @return {Promise}
 */
EventBridgeStore.prototype.removeEventByRemoteId = function(roomId, eventId) {
    return this.delete({
        "remote.roomId": roomId,
        "remote.eventId": eventId,
    });
};

module.exports = EventBridgeStore;
