/**
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
 *    matrix: { .. custom data eg name: "A happy place" .. }
 * }
 *
 * REMOTE (e.g. IRC)
 * {
 *    id: "irc.freenode.net_#channame",
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
 * A unique, non-sparse index can be set on the 'id' key, and non-unique,
 * sparse indexes can be set on matrix_id and remote_id to make mappings
 * quicker to compute.
 *
 */
"use strict";
var BridgeStore = require("./bridge-store");
var MatrixRoom = require("../models/rooms/matrix");
var RemoteRoom = require("../models/rooms/remote");
var util = require("util");

/**
 * Construct a store suitable for room bridging information. Data is stored
 * as {@link RoomBridgeStore~Entry}s which have the following
 * <i>serialized</i> format:
 * <pre>
 * {
 *   id: "unique_id",      // customisable
 *   matrix_id: "room_id",
 *   remote_id: "remote_room_id",
 *   matrix: { serialised matrix room info },
 *   remote: { serialised remote room info },
 *   data: { ... any additional info ... }
 * }
 * </pre>
 * <p>If a unique 'id' is not given, the store will generate one by concatenating
 * the <code>matrix_id</code> and the <code>remote_id</code>. The delimiter
 * used is a property on this store and can be modified.</p>
 * <p>The structure of Entry objects means that it is efficient to select based
 * off the 'id', 'matrix_id' or 'remote_id'. Additional indexes can be added
 * manually.</p>
 * @constructor
 * @param {Datastore} db The connected NEDB database instance
 * @param {Object} opts Options for this store.
 * @property {string} delimiter The delimiter between matrix and
 * remote IDs. Defaults to three spaces. If the schema of your remote IDs
 * allows spaces, you will need to change this.
 */
function RoomBridgeStore(db, opts) {
    this.db = db;
    this.delimiter = "   ";
}
util.inherits(RoomBridgeStore, BridgeStore);

/**
 * Insert an entry, clobbering based on the ID of the entry.
 * @param {RoomBridgeStore~Entry} entry
 * @return {Promise}
 */
RoomBridgeStore.prototype.upsertEntry = function(entry) {
    return this.upsert({
        id: entry.id
    }, serializeEntry(entry));
}

/**
 * Get an existing entry based on the provided entry ID.
 * @param {String} id The ID of the entry to retrieve.
 * @return {?RoomBridgeStore~Entry} A promise which resolves to the entry or null.
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
 * @return {RoomBridgeStore~Entry[]}
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
 * @return {Object.<string,RoomBridgeStore~Entry[]>} Resolves
 * to a map of room_id => Entry[]
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
 * Get a list of entries based on the remote_id of each entry.
 * @param {String} remoteId
 * @return {RoomBridgeStore~Entry[]}
 */
RoomBridgeStore.prototype.getEntriesByRemoteId = function(remoteId) {
    return this.select({
        remote_id: remoteId
    }, this.convertTo(function(doc) {
        return new Entry(doc);
    }));
};

/**
 * Create a link between a matrix room and remote room. This will create an entry with:
 * <ul>
 * <li>The matrix_id set to the matrix room ID.</li>
 * <li>The remote_id set to the remote room ID.</li>
 * <li>The id set to the id value given OR a concatenation of the matrix and remote IDs
 * if one is not provided.</li>
 * </ul>
 * @param {MatrixRoom} matrixRoom The matrix room
 * @param {RemoteRoom} remoteRoom The remote room
 * @param {Object=} data Information about this mapping.
 * @param {string=} linkId The id value to set. If not given, a unique ID will be
 * created from the matrix_id and remote_id.
 * @return {Promise}
 */
RoomBridgeStore.prototype.linkRooms = function(matrixRoom, remoteRoom, data, linkId) {
    data = data || {};
    linkId = linkId || createUniqueId(
        matrixRoom.getId(), remoteRoom.getId(), this.delimiter
    );
    var self = this;
    return self.upsert({
        id: linkId
    }, {
        id: linkId,
        remote_id: remoteRoom.getId(),
        matrix_id: matrixRoom.getId(),
        remote: remoteRoom.serialize(),
        matrix: matrixRoom.serialize(),
        data: data
    });
};

/**
 * Create an entry with only a matrix room. Sets the 'id' of the entry to the
 * Matrix room ID. If an entry already exists with this 'id', it will be replaced.
 * This function is useful if you just want to store a room with some data and not
 * worry about any mappings.
 * @param {MatrixRoom} matrixRoom
 * @return {Promise}
 * @see RoomBridgeStore#getMatrixRoom
 */
RoomBridgeStore.prototype.setMatrixRoom = function(matrixRoom) {
    return this.upsertEntry({
        id: matrixRoom.getId(),
        matrix_id: matrixRoom.getId(),
        matrix: matrixRoom
    });
};

/**
 * Get an entry's Matrix room based on the provided room_id. The entry MUST have
 * an 'id' of the room_id and there MUST be a Matrix room contained within the
 * entry for this to return.
 * @param {string} roomId
 * @return {?MatrixRoom}
 * @see RoomBridgeStore#setMatrixRoom
 */
RoomBridgeStore.prototype.getMatrixRoom = function(roomId) {
    return this.getEntryById(roomId).then(function(e) {
        return e ? e.matrix : null;
    });
};

/**
 * Get all entries with the given remote_id which have a Matrix room within.
 * @param {string} remoteId
 * @return {MatrixRoom[]}
 */
RoomBridgeStore.prototype.getLinkedMatrixRooms = function(remoteId) {
    return this.getEntriesByRemoteId(remoteId).then(function(entries) {
        return entries.filter(function(e) {
            return Boolean(e.matrix);
        }).map(function(e) {
            return e.matrix;
        });
    });
};

/**
 * Get all entries with the given matrix_id which have a Remote room within.
 * @param {string} matrixId
 * @return {RemoteRoom[]}
 */
RoomBridgeStore.prototype.getLinkedRemoteRooms = function(matrixId) {
    return this.getEntriesByMatrixId(matrixId).then(function(entries) {
        return entries.filter(function(e) {
            return Boolean(e.remote);
        }).map(function(e) {
            return e.remote;
        });
    });
};

/**
 * A batched version of <code>getLinkedRemoteRooms</code>.
 * @param {string[]} matrixIds
 * @return {Object.<string, RemoteRoom>} A mapping of room_id to RemoteRoom.
 * @see RoomBridgeStore#getLinkedRemoteRooms
 */
RoomBridgeStore.prototype.batchGetLinkedRemoteRooms = function(matrixIds) {
    return this.getEntriesByMatrixIds(matrixIds).then(function(entryMap) {
        Object.keys(entryMap).forEach(function(k) {
            entryMap[k] = entryMap[k].filter(function(e) {
                return Boolean(e.remote);
            }).map(function(e) {
                return e.remote;
            });
        })
        return entryMap;
    });
};


/**
 * Get a list of entries based on a RemoteRoom data value.
 * @param {Object} data The data values to retrieve based from.
 * @return {RoomBridgeStore~Entry[]} A list of entries
 * @example
 * remoteRoom.set("some_key", "some_val");
 * // store remoteRoom and then:
 * store.getEntriesByRemoteRoomData({
 *     some_key: "some_val"
 * });
 */
RoomBridgeStore.prototype.getEntriesByRemoteRoomData = function(data) {
    Object.keys(data).forEach(function(k) {
        var query = data[k];
        delete data[k];
        data["remote." + k] = query;
    });
    return this.select(data, this.convertTo(function(doc) {
        return new Entry(doc);
    }));
};

/**
 * Get a list of entries based on a MatrixRoom data value.
 * @param {Object} data The data values to retrieve based from.
 * @return {RoomBridgeStore~Entry[]} A list of entries
 * @example
 * matrixRoom.set("some_key", "some_val");
 * // store matrixRoom and then:
 * store.getEntriesByMatrixRoomData({
 *     some_key: "some_val"
 * });
 */
RoomBridgeStore.prototype.getEntriesByMatrixRoomData = function(data) {
    Object.keys(data).forEach(function(k) {
        var query = data[k];
        delete data[k];
        data["matrix.extras." + k] = query;
    });
    return this.select(data, this.convertTo(function(doc) {
        return new Entry(doc);
    }));
};

/**
 * Get a list of entries based on the link's data value.
 * @param {Object} data The data values to retrieve based from.
 * @return {RoomBridgeStore~Entry[]} A list of entries
 * @example
 * store.linkRooms(matrixRoom, remoteRoom, { some_key: "some_val" });
 * store.getEntriesByLinkData({
 *     some_key: "some_val"
 * });
 */
RoomBridgeStore.prototype.getEntriesByLinkData = function(data) {
    Object.keys(data).forEach(function(k) {
        var query = data[k];
        delete data[k];
        data["data." + k] = query;
    });
    return this.select(data, this.convertTo(function(doc) {
        return new Entry(doc);
    }));
};

/**
 * Remove entries based on remote room data.
 * @param {Object} data The data to match.
 * @return {Promise}
 * @example
 * remoteRoom.set("a_key", "a_val");
 * // store remoteRoom and then:
 * store.removeEntriesByRemoteRoomData({
 *     a_key: "a_val"
 * });
 */
RoomBridgeStore.prototype.removeEntriesByRemoteRoomData = function(data) {
    Object.keys(data).forEach(function(k) {
        var query = data[k];
        delete data[k];
        data["remote." + k] = query;
    });
    return this.delete(data);
};

/**
 * Remove entries with this remote room id.
 * @param {Object} remoteId The remote id.
 * @return {Promise}
 * @example
 * new RemoteRoom("foobar");
 * // store the RemoteRoom and then:
 * store.removeEntriesByRemoteRoomId("foobar");
 */
RoomBridgeStore.prototype.removeEntriesByRemoteRoomId = function(remoteId) {
    return this.delete({
      remote_id: remoteId
    });
};

/**
 * Remove entries based on matrix room data.
 * @param {Object} data The data to match.
 * @return {Promise}
 * @example
 * matrixRoom.set("a_key", "a_val");
 * // store matrixRoom and then:
 * store.removeEntriesByMatrixRoomData({
 *     a_key: "a_val"
 * });
 */
RoomBridgeStore.prototype.removeEntriesByMatrixRoomData = function(data) {
    Object.keys(data).forEach(function(k) {
        var query = data[k];
        delete data[k];
        data["matrix.extras." + k] = query;
    });
    return this.delete(data);
};

/**
 * Remove entries with this matrix room id.
 * @param {Object} matrixId The matrix id.
 * @return {Promise}
 * @example
 * new MatrixRoom("!foobar:matrix.org");
 * // store the MatrixRoom and then:
 * store.removeEntriesByMatrixRoomId("!foobar:matrix.org");
 */
RoomBridgeStore.prototype.removeEntriesByMatrixRoomId = function(matrixId) {
    return this.delete({
      matrix_id: matrixId
    });
};

/**
 * Remove entries based on the link's data value.
 * @param {Object} data The data to match.
 * @return {Promise}
 * @example
 * store.linkRooms(matrixRoom, remoteRoom, { a_key: "a_val" });
 * store.removeEntriesByLinkData({
 *     a_key: "a_val"
 * });
 */
RoomBridgeStore.prototype.removeEntriesByLinkData = function(data) {
    Object.keys(data).forEach(function(k) {
        var query = data[k];
        delete data[k];
        data["data." + k] = query;
    });
    return this.delete(data);
};


function createUniqueId(matrixRoomId, remoteRoomId, delimiter) {
    return (matrixRoomId || "") + delimiter + (remoteRoomId || "");
}


/**
 * Construct a new RoomBridgeStore Entry.
 * @constructor
 * @typedef RoomBridgeStore~Entry
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
