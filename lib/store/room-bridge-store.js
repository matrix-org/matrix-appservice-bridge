/*
 * Room storage format:
 * {
 *   type: "matrix|jungle",
 *   id: "room_id|jungle_id",
 *   data: {
 *     .. matrix-specific info e.g. room name ..
 *     .. jungle specific info e.g. IRC channel modes ..
 *   }
 * }
 *
 * There is also a third type, the "union" type. This binds together a single
 * matrix <--> jungle pairing. A single jungle ID can have many matrix_id and
 * vice versa, via mutliple union entries. Each union entry has an optional
 * 'data' attribute which functions in the same way as data for rooms.
 *
 * Example:
 * {
 *   type: "union",
 *   jungle_id: "#foo irc.domain.com",
 *   matrix_id: "!wefouh94w34rw:matrix.org",
 *   data: {
 *     from_config_file: true
 *   }
 * }
 */
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
 * @param {Object} updateQuery Update the room based on the data values given in this
 * object rather than the matrix room ID.
 * @return {Promise}
 */
RoomBridgeStore.prototype.setMatrixRoom = function(matrixRoom, updateQuery) {
    return setRoom(this, "matrix", matrixRoom, updateQuery);
};

/**
 * Store a Jungle room. If it already exists, it will be updated. Equivalence
 * is determined by the room ID.
 * @param {JungleRoom} jungleRoom The jungle room
 * @param {Object} updateQuery Update the room based on the data values given in this
 * object rather than the jungle ID.
 * @return {Promise}
 */
RoomBridgeStore.prototype.setJungleRoom = function(jungleRoom, updateQuery) {
    return setRoom(this, "jungle", jungleRoom, updateQuery);
};

/**
 * Get a matrix room by its' room ID.
 * @param {string|Object} roomIdOrDataQuery The room id or a data query object.
 * If the data query returns multiple entries, only 1 will be returned.
 * @return {Promise<?MatrixRoom, Error>} Resolves to the room or null if it
 * does not exist. Rejects with an error if there was a problem querying the store.
 */
RoomBridgeStore.prototype.getMatrixRoom = function(roomIdOrDataQuery) {
    return getRoom(this, "matrix", MatrixRoom, roomIdOrDataQuery, false);
};

/**
 * Get a jungle room by its' room ID.
 * @param {string|Object} roomIdOrDataQuery The room id or a data query object.
 * If the data query returns multiple entries, only 1 will be returned.
 * @return {Promise<?JungleRoom, Error>} Resolves to the room or null if it
 * does not exist. Rejects with an error if there was a problem querying the store.
 */
RoomBridgeStore.prototype.getJungleRoom = function(roomIdOrDataQuery) {
    return getRoom(this, "jungle", JungleRoom, roomIdOrDataQuery, false);
};

/**
 * Get a list of matrix rooms by a data query.
 * @param {Object} dataQuery A data query object.
 * @return {Promise<MatrixRoom[], Error>}
 */
RoomBridgeStore.prototype.getMatrixRooms = function(dataQuery) {
    return getRoom(this, "matrix", MatrixRoom, dataQuery, true);
};

/**
 * Get a list of jungle rooms by a data query.
 * @param {Object} dataQuery A data query object.
 * @return {Promise<JungleRoom[], Error>}
 */
RoomBridgeStore.prototype.getJungleRooms = function(dataQuery) {
    return getRoom(this, "jungle", JungleRoom, dataQuery, true);
};

// ************
// Link Methods
// ************

/**
 * Create a link between a matrix room and jungle room. This will insert the
 * given rooms if they do not exist before creating the mapping. This is done to
 * ensure foreign key constraints are satisfied (so you cannot have a mapping to
 * a room ID which does not exist).
 * @param {MatrixRoom} matrixRoom The matrix room
 * @param {JungleRoom} jungleRoom The jungle room
 * @param {Object=} data Information about this mapping.
 * @return {Promise}
 */
RoomBridgeStore.prototype.linkRooms = function(matrixRoom, jungleRoom, data) {
    data = data || {};
    var self = this;
    return self.insertIfNotExists({
        type: "jungle",
        id: jungleRoom.getId()
    }, {
        type: "jungle",
        id: jungleRoom.getId(),
        data: jungleRoom.serialize()
    }).then(function() {
        return self.insertIfNotExists({
            type: "matrix",
            id: matrixRoom.getId()
        }, {
            type: "matrix",
            id: matrixRoom.getId(),
            data: matrixRoom.serialize()
        });
    }).then(function() {
        return self.upsert({
            type: "union",
            jungle_id: jungleRoom.getId(),
            matrix_id: matrixRoom.getId()
        }, {
            type: "union",
            jungle_id: jungleRoom.getId(),
            matrix_id: matrixRoom.getId(),
            data: data
        });
    });
};

/**
 * Delete a link between a matrix room and a jungle room.
 * @param {MatrixUser} matrixRoom The matrix user
 * @param {JungleUser} jungleRoom The jungle user
 * @return {Promise<Number, Error>} Resolves to the number of entries removed.
 */
RoomBridgeStore.prototype.unlinkRooms = function(matrixRoom, jungleRoom) {
    return this.unlinkRoomIds(matrixRoom.getId(), jungleRoom.getId());
};

/**
 * Delete a link between a matrix room ID and a jungle room ID.
 * @param {string} matrixRoomId The matrix room ID
 * @param {string} jungleRoomId The jungle room ID
 * @return {Promise<Number, Error>} Resolves to the number of entries removed.
 */
RoomBridgeStore.prototype.unlinkRoomIds = function(matrixRoomId, jungleRoomId) {
    return this.delete({
        type: "union",
        jungle_id: jungleRoomId,
        matrix_id: matrixRoomId
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

RoomBridgeStore.prototype.getLinkedMatrixRooms = function(jungleId, dataQuery) {
    var self = this;
    return this.getMatrixLinks(jungleId, dataQuery).then(function(links) {
        var matrixIds = links.map(function(link) {
            return link.matrix;
        });
        return self.select({
            type: "matrix",
            id: { $in: matrixIds }
        }, self.convertTo(function(doc) {
            return new MatrixRoom(doc.id, doc.data);
        }));
    })
};

RoomBridgeStore.prototype.getLinkedJungleRooms = function(matrixId, dataQuery) {
    var self = this;
    return this.getJungleLinks(matrixId, dataQuery).then(function(links) {
        var jungleIds = links.map(function(link) {
            return link.jungle;
        });
        return self.select({
            type: "jungle",
            id: { $in: jungleIds }
        }, self.convertTo(function(doc) {
            return new JungleRoom(doc.id, doc.data);
        }));
    })
};


function setRoom(instance, type, room, updateQuery) {
    var query = {
        type: type
    };
    if (updateQuery && typeof updateQuery === "object") {
        Object.keys(updateQuery).forEach(function(key) {
            query["data." + key] = updateQuery[key];
        });
    }
    else {
        query.id = room.getId();
    }

    return instance.upsert(query, {
        type: type,
        id: room.getId(),
        data: room.serialize()
    });
}

function getRoom(instance, type, Cls, idOrQuery, allowMultiple) {
    var query = {
        type: type
    };
    if (typeof idOrQuery === "object") {
        Object.keys(idOrQuery).forEach(function(key) {
            query["data." + key] = idOrQuery[key];
        });
    }
    else {
        query.id = idOrQuery;
    }

    var method = allowMultiple ? "select" : "selectOne";

    return instance[method](query, instance.convertTo(function(doc) {
        return new Cls(doc.id, doc.data);
    }));
}

module.exports = RoomBridgeStore;

/**
 * @typedef RoomBridgeStore~Link
 * @type {Object}
 * @property {string} matrix The matrix room ID
 * @property {string} jungle The jungle room ID
 * @property {Object} data Information about this mapping, which may be an empty
 * object.
 */
