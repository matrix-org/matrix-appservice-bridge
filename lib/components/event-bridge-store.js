"use strict";
const BridgeStore = require("./bridge-store");
const StoreEvent = require("../models/events/event");
const util = require("util");

/**
 * Construct a store suitable for event mapping information. Data is stored
 * as {@link StoreEvent}s.
 * @constructor
 * @param {Datastore} db The connected NEDB database instance
 */
function EventBridgeStore(db) {
    this.db = db;
}

util.inherits(EventBridgeStore, BridgeStore);

/**
 * Insert an event, clobbering based on the ID of the StoreEvent.
 * @param {StoreEvent} event
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
 * @return {?StoreEvent} A promise which resolves to the StoreEvent or null.
 */
EventBridgeStore.prototype.getEntryByMatrixId = function(roomId, eventId) {
    return this.selectOne({
        "matrix.roomId": roomId,
        "matrix.eventId": eventId,
    }, this.convertTo(function(doc) {
        return StoreEvent.deserialize(doc);
    }));
}

/**
 * Get an existing event based on the provided remote IDs.
 * @param {string} roomId The ID of the room.
 * @param {string} eventId The ID of the event.
 * @return {?StoreEvent} A promise which resolves to the StoreEvent or null.
 */
EventBridgeStore.prototype.getEntryByRemoteId = function(roomId, eventId) {
    return this.selectOne({
        "remote.roomId": roomId,
        "remote.eventId": eventId,
    }, this.convertTo(function(doc) {
        return StoreEvent.deserialize(doc);
    }));
}

/**
 * Remove entries based on the event data.
 * @param {StoreEvent} event The event to remove.
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
