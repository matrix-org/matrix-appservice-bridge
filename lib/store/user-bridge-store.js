/*
 * User storage format:
 * {
 *   type: "matrix|jungle",
 *   id: "user_id|jungle_id",
 *   data: {
 *     .. matrix-specific info e.g. display name ..
 *     .. jungle specific info e.g. IRC username ..
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
 *   type: "jungle",
 *   id: "foobar@irc.freenode.net",
 *   data: {
 *     nickChoices: ["foobar", "foobar_", "foobar__"]
 *   }
 * }
 *
 * There is also a third type, the "union" type. This binds together a single
 * matrix <--> jungle pairing. A single jungle ID can have many matrix_id and
 * vice versa, via mutliple union entries.
 *
 * {
 *   type: "union",
 *   jungle_id: "foobar@irc.freenode.net",
 *   matrix_id: "@foo:bar"
 * }
 */
"use strict";
var BridgeStore = require("./bridge-store");
var MatrixUser = require("../users/matrix");
var JungleUser = require("../users/jungle");
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
 * Retrieve a list of corresponding jungle users for the given matrix user ID.
 * @param {string} userId The Matrix user ID
 * @return {Promise<JungleUser[], Error>} Resolves to a list of Jungle users.
 */
UserBridgeStore.prototype.getJungleUsersFromMatrixId = function(userId) {
    var self = this;
    return this.select({
        type: "union",
        matrix_id: userId
    }, self.convertTo(function(doc) {
        return doc.jungle_id;
    })).then(function(jungleIds) {
        return self.select({
            type: "jungle",
            id: { $in: jungleIds }
        }, self.convertTo(function(doc) {
            return new JungleUser(doc.id, doc.data);
        }));
    });
};

/**
 * Retrieve a list of corresponding matrix users for the given jungle ID.
 * @param {string} jungleId The Jungle ID
 * @return {Promise<MatrixUser[], Error>} Resolves to a list of Matrix users.
 */
UserBridgeStore.prototype.getMatrixUsersFromJungleId = function(jungleId) {
    var self = this;
    return this.select({
        type: "union",
        jungle_id: jungleId
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
        data: {
            localpart: localpart
        }
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
 * Get a jungle user by their jungle ID.
 * @param {string} id The jungle ID
 * @return {Promise<?JungleUser, Error>} Resolves to the user or null if they
 * do not exist. Rejects with an error if there was a problem querying the store.
 */
UserBridgeStore.prototype.getJungleUser = function(id) {
    return this.selectOne({
        type: "jungle",
        id: id
    }, this.convertTo(function(doc) {
        return new JungleUser(doc.id, doc.data);
    }));
};

/**
 * Get jungle users by some data about them, previously stored via the set
 * method on the Jungle user.
 * @param {Object} dataQuery The keys and matching values the jungle users share.
 * This should use dot notation for nested types. For example:
 * <code> { "topLevel.midLevel.leaf": 42, "otherTopLevel": "foo" } </code>
 * @return {Promise<JungleUser[], Error>} Resolves to a possibly empty list of
 * JungleUsers. Rejects with an error if there was a problem querying the store.
 * @throws If dataQuery isn't an object.
 * @example
 * jungleUser.set({
 *   toplevel: "foo",
 *   nested: {
 *     bar: {
 *       baz: 43
 *     }
 *   }
 * });
 * store.setJungleUser(jungleUser).then(function() {
 *   store.getByJungleData({
 *     "toplevel": "foo",
 *     "nested.bar.baz": 43
 *   })
 * });
 */
UserBridgeStore.prototype.getByJungleData = function(dataQuery) {
    if (typeof dataQuery !== "object") {
        throw new Error("Data query must be an object.");
    }
    var query = {};
    Object.keys(dataQuery).forEach(function(key) {
        query["data." + key] = dataQuery[key];
    });
    query.type = "jungle";

    return this.select(query, this.convertTo(function(doc) {
        return new JungleUser(doc.id, doc.data);
    }));
};

/**
 * Store a Jungle user. If they already exist, they will be updated. Equivalence
 * is determined by the Jungle ID.
 * @param {JungleUser} jungleUser The jungle user
 * @return {Promise}
 */
UserBridgeStore.prototype.setJungleUser = function(jungleUser) {
    return this.upsert({
        type: "jungle",
        id: jungleUser.getId()
    }, {
        type: "jungle",
        id: jungleUser.getId(),
        data: jungleUser.serialize()
    });
};

/**
 * Create a link between a matrix and jungle user.
 * @param {MatrixUser} matrixUser The matrix user
 * @param {JungleUser} jungleUser The jungle user
 * @param {boolean} storeUser Store each user in addition to creating the link.
 * If they already exist, they will be updated.
 * @return {Promise}
 */
UserBridgeStore.prototype.linkUsers = function(matrixUser, jungleUser, storeUsers) {
    if (!storeUsers) {
        return this.linkUserIds(matrixUser.getId(), jungleUser.getId());
    }
    var self = this;
    return this.setJungleUser(jungleUser).then(function() {
        return self.setMatrixUser(matrixUser);
    }).then(function() {
        return self.linkUserIds(matrixUser.getId(), jungleUser.getId());
    });
};

/**
 * Create a link between a matrix ID and jungle ID.
 * @param {string} matrixUserId The matrix user ID
 * @param {string} jungleUserId The jungle user ID
 * @return {Promise}
 */
UserBridgeStore.prototype.linkUserIds = function(matrixUserId, jungleUserId) {
    return this.upsert({
        type: "union",
        jungle_id: jungleUserId,
        matrix_id: matrixUserId
    }, {
        type: "union",
        jungle_id: jungleUserId,
        matrix_id: matrixUserId
    });
};

/**
 * Delete a link between a matrix user and a jungle user.
 * @param {MatrixUser} matrixUser The matrix user
 * @param {JungleUser} jungleUser The jungle user
 * @return {Promise<Number, Error>} Resolves to the number of entries removed.
 */
UserBridgeStore.prototype.unlinkUsers = function(matrixUser, jungleUser) {
    return this.unlinkUserIds(matrixUser.getId(), jungleUser.getId());
};

/**
 * Delete a link between a matrix user ID and a jungle user ID.
 * @param {string} matrixUserId The matrix user ID
 * @param {string} jungleUserId The jungle user ID
 * @return {Promise<Number, Error>} Resolves to the number of entries removed.
 */
UserBridgeStore.prototype.unlinkUserIds = function(matrixUserId, jungleUserId) {
    return this.delete({
        type: "union",
        jungle_id: jungleUserId,
        matrix_id: matrixUserId
    });
};

/**
 * Retrieve a list of matrix user IDs linked to this jungle ID.
 * @param {string} jungleId The jungle ID
 * @return {Promise<String[], Error>} A list of user IDs.
 */
UserBridgeStore.prototype.getMatrixLinks = function(jungleId) {
    return this.select({
        type: "union",
        jungle_id: jungleId
    }, this.convertTo(function(doc) {
        return doc.matrix_id;
    }));
};

/**
 * Retrieve a list of jungle IDs linked to this matrix user ID.
 * @param {string} matrixId The matrix user ID
 * @return {Promise<String[], Error>} A list of jungle IDs.
 */
UserBridgeStore.prototype.getJungleLinks = function(matrixId) {
    return this.select({
        type: "union",
        matrix_id: matrixId
    }, this.convertTo(function(doc) {
        return doc.jungle_id;
    }));
};

/** The UserBridgeStore class. */
module.exports = UserBridgeStore;
