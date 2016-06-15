/*
 * Room storage format:
 * {
 *   id: "matrix|remote|link_key",      // customisable
 *   matrix_id: "room_id",
 *   remote_id: "remote_room_id",
 *   matrix: { serialised matrix room info },
 *   remote: { serialised remote room info },
 *   data: { ... any additional info ... }
 * }
 *
 * Each document can either represent a matrix room, a remote room, or
 * a mapping. They look like this:
 * MATRIX
 * {
 *    id: "!room:id",
 *    matrix_id: "!room:id",
 *    remote_id: null,
 *    matrix: { .. custom data eg name: "A happy place" .. }
 * }
 *
 * REMOTE (e.g. IRC)
 * {
 *    id: "irc.freenode.net_#channame",
 *    matrix_id: null,
 *    remote_id: "irc.freenode.net_#channame",
 *    remote: { .. custom data e.g. is_pm_room: true .. }
 * }
 *
 * MAPPING
 * {
 *    id: "!room:id__irc.freenode.net_#channame", // link key; customisable.
 *    matrix_id: "!room:id",
 *    remote_id: "irc.freenode.net_#channame",
 *    matrix: { .. custom data .. },
 *    remote: { .. custom data .. },
 *    data: { .. custom data about the mapping ..}
 * }
 *
 * A unique index is forced on the 'id' key, and non-unique indexes are forced
 * on matrix_id and remote_id to make mappings quick to compute. You cannot
 * select based off the data fields `matrix`, `remote` and `data`.
 *
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
 * Insert an entry, clobbering based on the ID.
 * @param {Entry} entry
 */
RoomBridgeStore.prototype.upsertEntry = function(entry) {
    return this.upsert({
        id: entry.id
    }, serializeEntry(entry));
}

/**
 * Get an existing entry based on the provided ID.
 * @param {String} id
 */
RoomBridgeStore.prototype.getEntryById = function(id) {
    return this.selectOne({
        id: id
    }, this.convertTo(function(doc) {
        return new Entry(doc);
    }));
}

/**
 * Get a list of entries based on the matrix_id of each entry.
 * @param {string} matrixId
 */
RoomBridgeStore.prototype.getEntriesByMatrixId = function(matrixId) {
    return this.select({
        matrix_id: matrixId
    }, this.convertTo(function(doc) {
        return new Entry(doc);
    }));
};

/**
 * A batch version of <code>getEntriesByMatrixId</code>.
 * @param {String[]} ids
 * @return Promise<Map<string,Entry[]>, Error> Resolves to a map of room_id => Entry[]
 */
RoomBridgeStore.prototype.getEntriesByMatrixIds = function(ids) {
    return this.select({
        matrix_id: {
            $in: ids
        }
    }).then(function(docs) {
        var entries = {};
        docs.forEach(function(doc) {
            if (!entries[doc.matrix_id]) {
                entries[doc.matrix_id] = [];
            }
            entries[doc.matrix_id].push(new Entry(doc));
        });
        return entries;
    });
};

/**
 * Get entries based on their remote_id.
 * @param {String} remoteId
 */
RoomBridgeStore.prototype.getEntriesByRemoteId = function(remoteId) {
    return this.select({
        remote_id: remoteId
    }, this.convertTo(function(doc) {
        return new Entry(doc);
    }));
};

/**
 * Create a link between a matrix room and remote room.
 * @param {MatrixRoom} matrixRoom The matrix room
 * @param {RemoteRoom} remoteRoom The remote room
 * @param {Object=} data Information about this mapping.
 * @param {string=} linkKey An additional unique key value.
 * @return {Promise}
 */
RoomBridgeStore.prototype.linkRooms = function(matrixRoom, remoteRoom, data, linkKey) {
    data = data || {};
    linkKey = linkKey || createUniqueId(matrixRoom.getId(), remoteRoom.getId());
    var self = this;
    return self.upsert({
        id: linkKey
    }, {
        id: linkKey,
        remote_id: remoteRoom.getId(),
        matrix_id: matrixRoom.getId(),
        remote: remoteRoom.serialize(),
        matrix: matrixRoom.serialize(),
        data: data
    });
};

RoomBridgeStore.prototype.setMatrixRoom = function(matrixRoom) {
    return this.upsertEntry({
        id: matrixRoom.getId(),
        matrix_id: matrixRoom.getId(),
        matrix: matrixRoom
    });
};

RoomBridgeStore.prototype.getMatrixRoom = function(roomId) {
    return this.getEntryById(roomId).then(function(e) {
        return e ? e.matrix : null;
    });
};

RoomBridgeStore.prototype.getLinkedRemoteRooms = function(matrixId) {
    return this.getEntriesByMatrixId(matrixId).then(function(entries) {
        return entries.filter(function(e) {
            return Boolean(e.remote);
        }).map(function(e) {
            return e.remote;
        });
    });
};


function createUniqueId(matrixRoomId, remoteRoomId) {
    return (matrixRoomId || "") + "_@_" + (remoteRoomId || "");
}


/**
 * Construct a new RoomBridgeStore Entry.
 * @constructor
 * @property {string} id The unique ID for this entry.
 * @property {?MatrixRoom} matrix The matrix room, if applicable.
 * @property {?RemoteRoom} remote The remote room, if applicable.
 * @property {?Object} data Information about this mapping, which may be an empty.
 */
function Entry(doc) {
    doc = doc || {};
    this.id = doc.id;
    this.matrix = doc.matrix_id ? new MatrixRoom(doc.matrix_id, doc.matrix) : undefined;
    this.remote = doc.remote_id ? new RemoteRoom(doc.remote_id, doc.remote) : undefined;
    this.data = doc.data;
}

// not a member function so callers can provide a POJO
function serializeEntry(entry) {
    return {
        id: entry.id,
        remote_id: entry.remote ? entry.remote.getId() : undefined,
        matrix_id: entry.matrix ? entry.matrix.getId() : undefined,
        remote: entry.remote ? entry.remote.serialize() : undefined,
        matrix: entry.matrix ? entry.matrix.serialize() : undefined,
        data: entry.data
    }
}

module.exports = RoomBridgeStore;
