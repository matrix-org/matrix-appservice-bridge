"use strict";

/**
 * Construct a Matrix user.
 * @constructor
 * @param {string} userId The user_id of the user.
 * @param {Object=} data Serialized data values
 */
function MatrixUser(userId, data) {
    if (!userId) {
        throw new Error("Missing user_id");
    }
    if (data && Object.prototype.toString.call(data) !== "[object Object]") {
        throw new Error("data arg must be an Object");
    }
    this.userId = userId;
    this.localpart = this.userId.split(":")[0].substring(1);
    this._data = data || {};
}

/**
 * Get the matrix user's ID.
 * @return {string} The user ID
 */
MatrixUser.prototype.getId = function() {
    return this.userId;
};

/**
 * Get the display name for this Matrix user.
 * @return {?string} The display name.
 */
MatrixUser.prototype.getDisplayName = function() {
    return this._data.displayName;
};

/**
 * Set the display name for this Matrix user.
 * @param {string} name The Matrix display name.
 */
MatrixUser.prototype.setDisplayName = function(name) {
    this._data.displayName = name;
};

/**
 * Set an arbitrary bridge-specific data value for this user.
 * @param {string} key The key to store the data value under.
 * @param {*} val The data value. This value should be serializable via
 * <code>JSON.stringify(data)</code>.
 */
MatrixUser.prototype.set = function(key, val) {
    this._data[key] = val;
};

/**
 * Get the data value for the given key.
 * @param {string} key An arbitrary bridge-specific key.
 * @return {*} Stored data for this key. May be undefined.
 */
MatrixUser.prototype.get = function(key) {
    return this._data[key];
};

/**
 * Serialize all the data about this user, excluding the user ID.
 * @return {Object} The serialised data
 */
MatrixUser.prototype.serialize = function() {
    this._data.localpart = this.localpart;
    return this._data;
};

/** The MatrixUser class */
module.exports = MatrixUser;
