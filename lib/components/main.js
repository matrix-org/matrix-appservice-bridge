"use strict";
var Promise = require("bluebird");
var Datastore = require("nedb");
var RoomBridgeStore = require("./room-bridge-store");
var UserBridgeStore = require("./user-bridge-store");

var collection = {
    rooms: {
        db: null, loc: "matrix-bridge/rooms.db", defer: new Promise.defer(),
        cls: RoomBridgeStore
    },
    users: {
        db: null, loc: "matrix-bridge/users.db", defer: new Promise.defer(),
        cls: UserBridgeStore
    }
};

/**
 * Retrieve a connected BridgeStore instance.
 * @param {string} name The name of the store to retrieve. Either "rooms" or
 * "users".
 * @return {Promise<BridgeStore, Error>} Resolves when connected to the database.
 */
var get = function(name, opts) {
    opts = opts || { path: "" };
    if (!collection[name]) {
        return Promise.throw(new Error("Bad name: " + name));
    }
    if (collection[name].db) {
        return collection[name].defer.promise;
    }

    // connect if necessary
    collection[name].db = new Datastore({
        filename: opts.path + collection[name].loc,
        autoload: true,
        onload: function(err) {
            if (err) {
                collection[name].defer.reject(err);
            }
            else {
                var BridgeStoreCls = collection[name].cls;
                collection[name].defer.resolve(
                    new BridgeStoreCls(collection[name].db, opts)
                );
            }
        }
    });
    return collection[name].defer.promise;
};

/**
 * Retrieve a connected UserBridgeStore instance.
 * @return {Promise<UserBridgeStore, Error>} Resolves when connected to the database.
 */
module.exports.getUserBridgeStore = function(opts) {
    return get("users", opts);
};

/**
 * Retrieve a connected RoomBridgeStore instance.
 * @return {Promise<RoomBridgeStore, Error>} Resolves when connected to the database.
 */
module.exports.getRoomBridgeStore = function(opts) {
    return get("rooms", opts);
};
