"use strict";
var BridgeStore = require("./bridge-store");
var MatrixRoom = require("../rooms/matrix");
var JungleRoom = require("../rooms/jungle");
var util = require("util");

/**
 * Construct a store suitable for room bridging information.
 * @constructor
 * @param {Datastore} db The connected NEDB database instance
 * @param {Object} opts Options for this store.
 */
function RoomBridgeStore(db, opts) {
    this.db = db;
}
util.inherits(RoomBridgeStore, BridgeStore);

/**
 * Store a Matrix room. If it already exists, it will be updated. Equivalence
 * is determined by the room ID.
 * @param {MatrixRoom} matrixRoom The matrix room
 * @return {Promise}
 */
RoomBridgeStore.prototype.setMatrixRoom = function(matrixRoom) {
    return this.upsert({
        type: "matrix",
        id: matrixRoom.getId()
    }, {
        type: "matrix",
        id: matrixRoom.getId(),
        data: matrixRoom.serialize()
    });
};

/**
 * Get a matrix room by its' room ID.
 * @param {string} roomId The room_id
 * @return {Promise<?MatrixRoom, Error>} Resolves to the room or null if it
 * does not exist. Rejects with an error if there was a problem querying the store.
 */
RoomBridgeStore.prototype.getMatrixRoom = function(roomId) {
    return this.selectOne({
        type: "matrix",
        id: roomId
    }, this.convertTo(function(doc) {
        return new MatrixRoom(doc.id, doc.data);
    }));
};

/**
 * Get a jungle room by its' room ID.
 * @param {string} roomId The room id
 * @return {Promise<?JungleRoom, Error>} Resolves to the room or null if it
 * does not exist. Rejects with an error if there was a problem querying the store.
 */
RoomBridgeStore.prototype.getJungleRoom = function(roomId) {
    return this.selectOne({
        type: "jungle",
        id: roomId
    }, this.convertTo(function(doc) {
        return new JungleRoom(doc.id, doc.data);
    }));
};

/**
 * Store a Jungle room. If it already exists, it will be updated. Equivalence
 * is determined by the room ID.
 * @param {JungleRoom} jungleRoom The jungle room
 * @return {Promise}
 */
RoomBridgeStore.prototype.setJungleRoom = function(jungleRoom) {
    return this.upsert({
        type: "jungle",
        id: jungleRoom.getId()
    }, {
        type: "jungle",
        id: jungleRoom.getId(),
        data: jungleRoom.serialize()
    });
};

/**
 * Create a link between a matrix ID and jungle ID.
 * @param {string} matrixRoomId The matrix room ID
 * @param {string} jungleRoomId The jungle room ID
 * @param {Object=} data Information about this mapping.
 * @return {Promise}
 */
RoomBridgeStore.prototype.linkRoomIds = function(matrixRoomId, jungleRoomId, data) {
    data = data || {};
    return this.upsert({
        type: "union",
        jungle_id: jungleRoomId,
        matrix_id: matrixRoomId
    }, {
        type: "union",
        jungle_id: jungleRoomId,
        matrix_id: matrixRoomId,
        data: data
    });
};

/**
 * Retrieve a list of links based on some information about the links themselves.
 * @param {Object} dataQuery The keys and matching values the links share.
 * This should use dot notation for nested types. For example:
 * <code> { "topLevel.midLevel.leaf": 42, "otherTopLevel": "foo" } </code>
 * @return {Promise<{RoomBridgeStore~Link[], Error>} Resolves to a possibly
 * empty list of {@link RoomBridgeStore~Link} objects. Rejects with an error if
 * there was a problem querying the store.
 * @throws If dataQuery isn't an object.
 * @example
 * store.linkRoomIds("!foo:bar", "_foo_bar", {
 *   custom: {
 *     stuff: "goes here"
 *   },
 *   or: "here"
 * });
 * store.getLinksByData({
 *   "custom.stuff": "goes here"
 * });
 */
RoomBridgeStore.prototype.getLinksByData = function(dataQuery) {
    if (typeof dataQuery !== "object") {
        throw new Error("Data query must be an object.");
    }
    var query = {};
    Object.keys(dataQuery).forEach(function(key) {
        query["data." + key] = dataQuery[key];
    });
    query.type = "union";

    return this.select(query, this.convertTo(function(doc) {
        return {
            matrix: doc.matrix_id,
            jungle: doc.jungle_id,
            data: doc.data
        };
    }));
};

/**
 * Retrieve a list of matrix room IDs linked to this jungle ID.
 * @param {string} jungleId The jungle ID
 * @return {Promise<RoomBridgeStore~Link[], Error>} A list of room IDs.
 */
RoomBridgeStore.prototype.getMatrixLinks = function(jungleId) {
    return this.select({
        type: "union",
        jungle_id: jungleId
    }, this.convertTo(function(doc) {
        return {
            matrix: doc.matrix_id,
            jungle: doc.jungle_id,
            data: doc.data
        };
    }));
};

/**
 * Retrieve a list of jungle IDs linked to this matrix room ID.
 * @param {string} matrixId The matrix room ID
 * @return {Promise<RoomBridgeStore~Link[], Error>} A list of jungle IDs.
 */
RoomBridgeStore.prototype.getJungleLinks = function(matrixId) {
    return this.select({
        type: "union",
        matrix_id: matrixId
    }, this.convertTo(function(doc) {
        return {
            matrix: doc.matrix_id,
            jungle: doc.jungle_id,
            data: doc.data
        };
    }));
};

module.exports = RoomBridgeStore;

/**
 * @typedef RoomBridgeStore~Link
 * @type {Object}
 * @property {string} matrix The matrix room ID
 * @property {string} jungle The jungle room ID
 * @property {Object} data Information about this mapping, which may be an empty
 * object.
 */
