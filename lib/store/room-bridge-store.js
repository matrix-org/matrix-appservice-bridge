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
UserBridgeStore.prototype.setMatrixRoom = function(matrixRoom) {
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
UserBridgeStore.prototype.getMatrixRoom = function(roomId) {
    return this.selectOne({
        type: "matrix",
        id: roomId
    }, this.convertTo(function(doc) {
        return new MatrixRoom(doc.id, doc.data);
    }));
};

module.exports = RoomBridgeStore;
