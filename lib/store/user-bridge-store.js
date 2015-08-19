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
 *     displayName: "Foo Bar"
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
// var MatrixUser = require("../users/matrix");
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

UserBridgeStore.prototype.getJungleUsersFromMatrixId = function(userId) {

};

UserBridgeStore.prototype.getMatrixUsersFromJungleId = function(jungleId) {

};

UserBridgeStore.prototype.getByMatrixLocalpart = function(localpart) {

};

UserBridgeStore.prototype.getByMatrixId = function(userId) {

};

UserBridgeStore.prototype.storeMatrixUser = function(matrixUser) {

};

/**
 * Get a jungle user by their jungle ID.
 * @param {string} id The jungle ID
 * @return {Promise<?JungleUser, Error>} Resolves to the user or null if they
 * do not exist. Rejects with an error if there was a problem querying the store.
 */
UserBridgeStore.prototype.getByJungleId = function(id) {
    return this.selectOne({
        type: "jungle",
        id: id
    }, function(doc) {
        if (doc) {
            return new JungleUser(doc.id, doc.data);
        }
        return null;
    });
};

/**
 * Get jungle users by some data about them.
 * @param {Object} dataQuery The keys and matching values the jungle users share.
 * @return {Promise<JungleUser[], Error>} Resolves to a possibly empty list of
 * JungleUsers. Rejects with an error if there was a problem querying the store.
 */
UserBridgeStore.prototype.getByJungleData = function(dataQuery) {

};

UserBridgeStore.prototype.storeJungleUser = function(jungleUser) {
    return this.upsert({
        type: "jungle",
        id: jungleUser.getId()
    }, {
        type: "jungle",
        id: jungleUser.getId(),
        data: jungleUser.getData()
    });
};


module.exports = UserBridgeStore;
