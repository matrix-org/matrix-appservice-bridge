/*
 * Room storage format:
 * {
 *   type: "matrix|remote",
 *   id: "room_id|remote_id",
 *   data: {
 *     .. matrix-specific info e.g. room name ..
 *     .. remote specific info e.g. IRC channel modes ..
 *   }
 * }
 *
 * There is also a third type, the "union" type. This binds together a single
 * matrix <--> remote pairing. A single remote ID can have many matrix_id and
 * vice versa, via multiple union entries. Each union entry has an optional
 * 'data' attribute which functions in the same way as data for rooms. Unions
 * are keyed off a unique 'link_key' which is normally a concatenation of the
 * remote and matrix room ID.
 *
 * Example:
 * {
 *   type: "union",
 *   link_key: "!wefouh94w34rw:matrix.org #foo irc.domain.com",
 *   remote_id: "#foo irc.domain.com",
 *   matrix_id: "!wefouh94w34rw:matrix.org",
 *   data: {
 *     from_config_file: true
 *   }
 * }
 *
 * Union types clobber based off the link_key. This key can be customised by the
 * caller. This is useful for clobbering links based on custom data (e.g.
 * user ID tuples for admin rooms).
 */
"use strict";
var BridgeStore = require("./bridge-store");
var MatrixRoom = require("../models/rooms/matrix");
var RemoteRoom = require("../models/rooms/remote");
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
 * Store a Remote room. If it already exists, it will be updated. Equivalence
 * is determined by the room ID.
 * @param {RemoteRoom} remoteRoom The remote room
 * @param {Object} updateQuery Update the room based on the data values given in this
 * object rather than the remote ID.
 * @return {Promise}
 */
RoomBridgeStore.prototype.setRemoteRoom = function(remoteRoom, updateQuery) {
    return setRoom(this, "remote", remoteRoom, updateQuery);
};

/**
 * Get a matrix room by its' room ID.
 * @param {string|Object} roomIdOrDataQuery The room id or a data query object.
 * If the data query returns multiple entries, only 1 will be returned. Data queries
 * for keys set via <code>MatrixRoom.set(key, val)</code> MUST be prefixed with
 * 'extras.'
 * @return {Promise<?MatrixRoom, Error>} Resolves to the room or null if it
 * does not exist. Rejects with an error if there was a problem querying the store.
 * @see RoomBridgeStore.getMatrixRooms
 */
RoomBridgeStore.prototype.getMatrixRoom = function(roomIdOrDataQuery) {
    return getRoom(this, "matrix", MatrixRoom, roomIdOrDataQuery, false);
};

/**
 * Get a remote room by its' room ID.
 * @param {string|Object} roomIdOrDataQuery The room id or a data query object.
 * If the data query returns multiple entries, only 1 will be returned.
 * @return {Promise<?RemoteRoom, Error>} Resolves to the room or null if it
 * does not exist. Rejects with an error if there was a problem querying the store.
 */
RoomBridgeStore.prototype.getRemoteRoom = function(roomIdOrDataQuery) {
    return getRoom(this, "remote", RemoteRoom, roomIdOrDataQuery, false);
};

/**
 * Get a list of matrix rooms by a data query.
 * @param {Object} dataQuery A data query object. Queries for keys set via
 * <code>MatrixRoom.set(key, val)</code> MUST be prefixed with 'extras.'
 * @return {Promise<MatrixRoom[], Error>}
 * @example
 * store.getMatrixRooms({
 *   name: "A room name",
 *   "extras.some_new_key": "some new val"
 * });
 */
RoomBridgeStore.prototype.getMatrixRooms = function(dataQuery) {
    return getRoom(this, "matrix", MatrixRoom, dataQuery, true);
};

/**
 * Get a list of remote rooms by a data query.
 * @param {Object} dataQuery A data query object.
 * @return {Promise<RemoteRoom[], Error>}
 */
RoomBridgeStore.prototype.getRemoteRooms = function(dataQuery) {
    return getRoom(this, "remote", RemoteRoom, dataQuery, true);
};

// ************
// Link Methods
// ************

/**
 * Create a link between a matrix room and remote room. This will insert the
 * given rooms if they do not exist before creating the mapping. This is done to
 * ensure foreign key constraints are satisfied (so you cannot have a mapping to
 * a room ID which does not exist).
 * @param {MatrixRoom} matrixRoom The matrix room
 * @param {RemoteRoom} remoteRoom The remote room
 * @param {Object=} data Information about this mapping.
 * @param {string=} linkKey An additional unique key value.
 * @return {Promise}
 */
RoomBridgeStore.prototype.linkRooms = function(matrixRoom, remoteRoom, data, linkKey) {
    data = data || {};
    linkKey = linkKey || createLinkKey(matrixRoom.getId(), remoteRoom.getId());
    var self = this;
    return self.insertIfNotExists({
        type: "remote",
        id: remoteRoom.getId()
    }, {
        type: "remote",
        id: remoteRoom.getId(),
        data: remoteRoom.serialize()
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
            link_key: linkKey
        }, {
            type: "union",
            link_key: linkKey,
            remote_id: remoteRoom.getId(),
            matrix_id: matrixRoom.getId(),
            data: data
        });
    });
};

/**
 * Delete a link between a matrix room and a remote room.
 * @param {MatrixUser} matrixRoom The matrix user
 * @param {RemoteUser} remoteRoom The remote user
 * @return {Promise<Number, Error>} Resolves to the number of entries removed.
 */
RoomBridgeStore.prototype.unlinkRooms = function(matrixRoom, remoteRoom) {
    return this.unlinkRoomIds(matrixRoom.getId(), remoteRoom.getId());
};

/**
 * Delete a link between a matrix room ID and a remote room ID. This creates a
 * link key based on the provided IDs.
 * @param {string} matrixRoomId The matrix room ID
 * @param {string} remoteRoomId The remote room ID
 * @return {Promise<Number, Error>} Resolves to the number of entries removed.
 */
RoomBridgeStore.prototype.unlinkRoomIds = function(matrixRoomId, remoteRoomId) {
    return this.unlinkByKey(createLinkKey(matrixRoomId, remoteRoomId))
};

/**
 * Delete a link between a matrix room ID and a remote room ID based on a link
 * key.
 * @param {string} linkKey The link key to delete links by.
 * @return {Promise<Number, Error>} Resolves to the number of entries removed.
 */
RoomBridgeStore.prototype.unlinkByKey = function(linkKey) {
    return this.delete({
        type: "union",
        link_key: linkKey
    });
};

RoomBridgeStore.prototype.getLinksByKey = function(linkKey) {
    return this.select({
        link_key: linkKey
    }, this.convertTo(function(doc) {
        return {
            matrix: doc.matrix_id,
            remote: doc.remote_id,
            link_key: linkKey,
            data: doc.data
        };
    }));
}

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
            remote: doc.remote_id,
            link_key: doc.link_key,
            data: doc.data
        };
    }));
};

/**
 * Delete links which have the matching data.
 * @param {Object} dataQuery The data query to match.
 * @return {Promise<Number, Error>} Resolves to the number of entries removed.
 */
RoomBridgeStore.prototype.unlinkByData = function(dataQuery) {
    if (typeof dataQuery !== "object") {
        throw new Error("Data query must be an object.");
    }
    var query = {};
    Object.keys(dataQuery).forEach(function(key) {
        query["data." + key] = dataQuery[key];
    });
    query.type = "union";
    return this.delete(query);
};

/**
 * Retrieve a list of matrix room IDs linked to this remote ID.
 * @param {string} remoteId The remote ID
 * @return {Promise<RoomBridgeStore~Link[], Error>} A list of room IDs.
 */
RoomBridgeStore.prototype.getMatrixLinks = function(remoteId) {
    return this.select({
        type: "union",
        remote_id: remoteId
    }, this.convertTo(function(doc) {
        return {
            matrix: doc.matrix_id,
            remote: doc.remote_id,
            data: doc.data
        };
    }));
};

/**
 * Retrieve a list of remote IDs linked to this matrix room ID.
 * @param {string} matrixId The matrix room ID
 * @return {Promise<RoomBridgeStore~Link[], Error>} A list of remote IDs.
 */
RoomBridgeStore.prototype.getRemoteLinks = function(matrixId) {
    return this.select({
        type: "union",
        matrix_id: matrixId
    }, this.convertTo(function(doc) {
        return {
            matrix: doc.matrix_id,
            remote: doc.remote_id,
            data: doc.data
        };
    }));
};

/**
 * Retrieve a list of remote IDs linked to a list of matrix room IDs.
 * @param {Array<string>} matrixIds A list of matrix room IDs to search for.
 * @return {Promise<Map<string, RoomBridgeStore~Link[]>, Error>} A promise
 * which resolves to a map with the keys as room IDs and the values set to a
 * list of room links. If the same room ID appears multiple times in the
 * input array, only 1 of the keys will be present in the map.
 */
RoomBridgeStore.prototype.batchGetRemoteLinks = function(matrixIds) {
    return this.select({
        type: "union",
        matrix_id: {
            $in: matrixIds
        }
    }).then(function(docs) {
        var matrixIdMap = {};
        docs = docs || [];
        docs.forEach(function(doc) {
            if (!matrixIdMap[doc.matrix_id]) {
                matrixIdMap[doc.matrix_id] = [];
            }
            matrixIdMap[doc.matrix_id].push({
                matrix: doc.matrix_id,
                remote: doc.remote_id,
                data: doc.data
            });
        });
        return matrixIdMap;
    });
};

/**
 * Get Matrix rooms linked to the given remote ID.
 * @param {string} remoteId The remote room ID
 * @param {Object=} dataQuery Additional constraints to apply to the set of
 * returned rooms.
 * @return {Promise<MatrixRoom[],Error>} A list of matrix rooms.
 */
RoomBridgeStore.prototype.getLinkedMatrixRooms = function(remoteId, dataQuery) {
    var self = this;
    return this.getMatrixLinks(remoteId, dataQuery).then(function(links) {
        var matrixIds = links.map(function(link) {
            return link.matrix;
        });
        if (matrixIds.length === 0) {
            return [];
        }
        return self.select({
            type: "matrix",
            id: { $in: matrixIds }
        }, self.convertTo(function(doc) {
            return new MatrixRoom(doc.id, doc.data);
        }));
    })
};

/**
 * Get remote rooms linked to the given matrix ID.
 * @param {string} matrixId The matrix room ID
 * @param {Object=} dataQuery Additional constraints to apply to the set of
 * returned rooms.
 * @return {Promise<RemoteRoom[],Error>} A list of remote rooms.
 */
RoomBridgeStore.prototype.getLinkedRemoteRooms = function(matrixId, dataQuery) {
    var self = this;
    return this.getRemoteLinks(matrixId, dataQuery).then(function(links) {
        var remoteIds = links.map(function(link) {
            return link.remote;
        });
        if (remoteIds.length === 0) {
            return [];
        }
        return self.select({
            type: "remote",
            id: { $in: remoteIds }
        }, self.convertTo(function(doc) {
            return new RemoteRoom(doc.id, doc.data);
        }));
    })
};

function createLinkKey(matrixRoomId, remoteRoomId) {
    return (matrixRoomId || "") + " " + (remoteRoomId || "");
}

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
 * @property {string} remote The remote room ID
 * @property {string} link_key The unique key for this link.
 * @property {Object} data Information about this mapping, which may be an empty
 * object.
 */
