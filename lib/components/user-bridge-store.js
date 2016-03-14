/*
 * User storage format:
 * {
 *   type: "matrix|remote",
 *   id: "user_id|remote_id",
 *   data: {
 *     .. matrix-specific info e.g. display name ..
 *     .. remote specific info e.g. IRC username ..
 *   }
 * }
 * Examples:
 * {
 *   type: "matrix",
 *   id: "@foo:bar",
 *   data: {
 *     localpart: "foo",      // Required.
 *     displayName: "Foo Bar" // Optional.
 *   }
 * }
 *
 * {
 *   type: "remote",
 *   id: "foobar@irc.freenode.net",
 *   data: {
 *     nickChoices: ["foobar", "foobar_", "foobar__"]
 *   }
 * }
 *
 * There is also a third type, the "union" type. This binds together a single
 * matrix <--> remote pairing. A single remote ID can have many matrix_id and
 * vice versa, via mutliple union entries.
 *
 * {
 *   type: "union",
 *   remote_id: "foobar@irc.freenode.net",
 *   matrix_id: "@foo:bar"
 * }
 */
"use strict";
var BridgeStore = require("./bridge-store");
var MatrixUser = require("../models/users/matrix");
var RemoteUser = require("../models/users/remote");
var util = require("util");

/**
 * Construct a store suitable for user bridging information.
 * @constructor
 * @param {Datastore} db The connected NEDB database instance
 * @param {Object} opts Options for this store.
 */
function UserBridgeStore(db, opts) {
    this.db = db;
}
util.inherits(UserBridgeStore, BridgeStore);

/**
 * Retrieve a list of corresponding remote users for the given matrix user ID.
 * @param {string} userId The Matrix user ID
 * @return {Promise<RemoteUser[], Error>} Resolves to a list of Remote users.
 */
UserBridgeStore.prototype.getRemoteUsersFromMatrixId = function(userId) {
    var self = this;
    return this.select({
        type: "union",
        matrix_id: userId
    }, self.convertTo(function(doc) {
        return doc.remote_id;
    })).then(function(remoteIds) {
        return self.select({
            type: "remote",
            id: { $in: remoteIds }
        }, self.convertTo(function(doc) {
            return new RemoteUser(doc.id, doc.data);
        }));
    });
};

/**
 * Retrieve a list of corresponding matrix users for the given remote ID.
 * @param {string} remoteId The Remote ID
 * @return {Promise<MatrixUser[], Error>} Resolves to a list of Matrix users.
 */
UserBridgeStore.prototype.getMatrixUsersFromRemoteId = function(remoteId) {
    var self = this;
    return this.select({
        type: "union",
        remote_id: remoteId
    }, self.convertTo(function(doc) {
        return doc.matrix_id;
    })).then(function(matrixUserIds) {
        return self.select({
            type: "matrix",
            id: { $in: matrixUserIds }
        }, self.convertTo(function(doc) {
            return new MatrixUser(doc.id, doc.data);
        }));
    });
};

/**
 * Retrieve a MatrixUser based on their user ID localpart. If there is more than
 * one match (e.g. same localpart, different domains) then this will return an
 * arbitrary matching user.
 * @param {string} localpart The user localpart
 * @return {Promise<?MatrixUser, Error>} Resolves to a MatrixUser or null.
 */
UserBridgeStore.prototype.getByMatrixLocalpart = function(localpart) {
    return this.selectOne({
        type: "matrix",
        "data.localpart": localpart
    }, this.convertTo(function(doc) {
        return new MatrixUser(doc.id, doc.data);
    }));
};

/**
 * Get a matrix user by their user ID.
 * @param {string} userId The user_id
 * @return {Promise<?MatrixUser, Error>} Resolves to the user or null if they
 * do not exist. Rejects with an error if there was a problem querying the store.
 */
UserBridgeStore.prototype.getMatrixUser = function(userId) {
    return this.selectOne({
        type: "matrix",
        id: userId
    }, this.convertTo(function(doc) {
        return new MatrixUser(doc.id, doc.data);
    }));
};

/**
 * Store a Matrix user. If they already exist, they will be updated. Equivalence
 * is determined by their user ID.
 * @param {MatrixUser} matrixUser The matrix user
 * @return {Promise}
 */
UserBridgeStore.prototype.setMatrixUser = function(matrixUser) {
    return this.upsert({
        type: "matrix",
        id: matrixUser.getId()
    }, {
        type: "matrix",
        id: matrixUser.getId(),
        data: matrixUser.serialize()
    });
};

/**
 * Get a remote user by their remote ID.
 * @param {string} id The remote ID
 * @return {Promise<?RemoteUser, Error>} Resolves to the user or null if they
 * do not exist. Rejects with an error if there was a problem querying the store.
 */
UserBridgeStore.prototype.getRemoteUser = function(id) {
    return this.selectOne({
        type: "remote",
        id: id
    }, this.convertTo(function(doc) {
        return new RemoteUser(doc.id, doc.data);
    }));
};

/**
 * Get remote users by some data about them, previously stored via the set
 * method on the Remote user.
 * @param {Object} dataQuery The keys and matching values the remote users share.
 * This should use dot notation for nested types. For example:
 * <code> { "topLevel.midLevel.leaf": 42, "otherTopLevel": "foo" } </code>
 * @return {Promise<RemoteUser[], Error>} Resolves to a possibly empty list of
 * RemoteUsers. Rejects with an error if there was a problem querying the store.
 * @throws If dataQuery isn't an object.
 * @example
 * remoteUser.set({
 *   toplevel: "foo",
 *   nested: {
 *     bar: {
 *       baz: 43
 *     }
 *   }
 * });
 * store.setRemoteUser(remoteUser).then(function() {
 *   store.getByRemoteData({
 *     "toplevel": "foo",
 *     "nested.bar.baz": 43
 *   })
 * });
 */
UserBridgeStore.prototype.getByRemoteData = function(dataQuery) {
    if (typeof dataQuery !== "object") {
        throw new Error("Data query must be an object.");
    }
    var query = {};
    Object.keys(dataQuery).forEach(function(key) {
        query["data." + key] = dataQuery[key];
    });
    query.type = "remote";

    return this.select(query, this.convertTo(function(doc) {
        return new RemoteUser(doc.id, doc.data);
    }));
};

/**
 * Get Matrix users by some data about them, previously stored via the set
 * method on the Matrix user.
 * @param {Object} dataQuery The keys and matching values the remote users share.
 * This should use dot notation for nested types. For example:
 * <code> { "topLevel.midLevel.leaf": 42, "otherTopLevel": "foo" } </code>
 * @return {Promise<MatrixUser[], Error>} Resolves to a possibly empty list of
 * MatrixUsers. Rejects with an error if there was a problem querying the store.
 * @throws If dataQuery isn't an object.
 * @example
 * matrixUser.set({
 *   toplevel: "foo",
 *   nested: {
 *     bar: {
 *       baz: 43
 *     }
 *   }
 * });
 * store.setMatrixUser(matrixUser).then(function() {
 *   store.getByMatrixData({
 *     "toplevel": "foo",
 *     "nested.bar.baz": 43
 *   })
 * });
 */
UserBridgeStore.prototype.getByMatrixData = function(dataQuery) {
    if (typeof dataQuery !== "object") {
        throw new Error("Data query must be an object.");
    }
    var query = {};
    Object.keys(dataQuery).forEach(function(key) {
        query["data." + key] = dataQuery[key];
    });
    query.type = "matrix";

    return this.select(query, this.convertTo(function(doc) {
        return new MatrixUser(doc.id, doc.data);
    }));
};

/**
 * Store a Remote user. If they already exist, they will be updated. Equivalence
 * is determined by the Remote ID.
 * @param {RemoteUser} remoteUser The remote user
 * @return {Promise}
 */
UserBridgeStore.prototype.setRemoteUser = function(remoteUser) {
    return this.upsert({
        type: "remote",
        id: remoteUser.getId()
    }, {
        type: "remote",
        id: remoteUser.getId(),
        data: remoteUser.serialize()
    });
};

/**
 * Create a link between a matrix and remote user. If either user does not exist,
 * they will be inserted prior to linking. This is done to ensure foreign key
 * constraints are satisfied (so you cannot have a mapping to a user ID which
 * does not exist).
 * @param {MatrixUser} matrixUser The matrix user
 * @param {RemoteUser} remoteUser The remote user
 * @return {Promise}
 */
UserBridgeStore.prototype.linkUsers = function(matrixUser, remoteUser) {
    var self = this;
    return self.insertIfNotExists({
        type: "remote",
        id: remoteUser.getId()
    }, {
        type: "remote",
        id: remoteUser.getId(),
        data: remoteUser.serialize()
    }).then(function() {
        return self.insertIfNotExists({
            type: "matrix",
            id: matrixUser.getId()
        }, {
            type: "matrix",
            id: matrixUser.getId(),
            data: matrixUser.serialize()
        });
    }).then(function() {
        return self.upsert({
            type: "union",
            remote_id: remoteUser.getId(),
            matrix_id: matrixUser.getId()
        }, {
            type: "union",
            remote_id: remoteUser.getId(),
            matrix_id: matrixUser.getId()
        });
    });
};

/**
 * Delete a link between a matrix user and a remote user.
 * @param {MatrixUser} matrixUser The matrix user
 * @param {RemoteUser} remoteUser The remote user
 * @return {Promise<Number, Error>} Resolves to the number of entries removed.
 */
UserBridgeStore.prototype.unlinkUsers = function(matrixUser, remoteUser) {
    return this.unlinkUserIds(matrixUser.getId(), remoteUser.getId());
};

/**
 * Delete a link between a matrix user ID and a remote user ID.
 * @param {string} matrixUserId The matrix user ID
 * @param {string} remoteUserId The remote user ID
 * @return {Promise<Number, Error>} Resolves to the number of entries removed.
 */
UserBridgeStore.prototype.unlinkUserIds = function(matrixUserId, remoteUserId) {
    return this.delete({
        type: "union",
        remote_id: remoteUserId,
        matrix_id: matrixUserId
    });
};

/**
 * Retrieve a list of matrix user IDs linked to this remote ID.
 * @param {string} remoteId The remote ID
 * @return {Promise<String[], Error>} A list of user IDs.
 */
UserBridgeStore.prototype.getMatrixLinks = function(remoteId) {
    return this.select({
        type: "union",
        remote_id: remoteId
    }, this.convertTo(function(doc) {
        return doc.matrix_id;
    }));
};

/**
 * Retrieve a list of remote IDs linked to this matrix user ID.
 * @param {string} matrixId The matrix user ID
 * @return {Promise<String[], Error>} A list of remote IDs.
 */
UserBridgeStore.prototype.getRemoteLinks = function(matrixId) {
    return this.select({
        type: "union",
        matrix_id: matrixId
    }, this.convertTo(function(doc) {
        return doc.remote_id;
    }));
};

/** The UserBridgeStore class. */
module.exports = UserBridgeStore;
