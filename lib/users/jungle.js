"use strict";

/**
 * Construct a new Jungle user.
 * @constructor
 * @param {string} identifier The unique ID for this user.
 * @param {Object} data The key-value data object to assign to this user.
 * @throws If identifier is not supplied.
 */
function JungleUser(identifier, data) {
    if (!identifier) {
        throw new Error("Missing identifier");
    }
    this.id = identifier;
    this.data = data || {};
}

/**
 * Get the Jungle user's ID.
 * @return {string} Their ID.
 */
JungleUser.prototype.getId = function() {
    return this.id;
};

/**
 * Serialize all the data about this user, excluding their jungle ID.
 * @return {Object} The serialised data
 */
JungleUser.prototype.getData = function() {
    return this.data;
}

/**
 * Get the data value for the given key.
 * @param {string} key An arbitrary bridge-specific key.
 * @return {*} Stored data for this key. May be undefined.
 */
JungleUser.prototype.get = function(key) {
    return this.data[key];
};

/**
 * Set an arbitrary bridge-specific data value for this user.
 * @param {string} key The key to store the data value under.
 * @param {*} val The data value. This value should be serializable via
 * <code>JSON.stringify(data)</code>.
 */
JungleUser.prototype.set = function(key, val) {
    this.data[key] = val;
};

/** The Jungle user class. */
module.exports = JungleUser;
