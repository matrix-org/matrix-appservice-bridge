"use strict";

/**
 * Construct a Matrix user.
 * @constructor
 * @param {string} userId The user_id of the user.
 * @param {Object=} data Serialized data values
 * @param {boolean} escape [true] Escape the user's localpart.
 */
function MatrixUser(userId, data, escape=true) {
    if (!userId) {
        throw new Error("Missing user_id");
    }
    if (data && Object.prototype.toString.call(data) !== "[object Object]") {
        throw new Error("data arg must be an Object");
    }
    this.userId = userId;
    const split = this.userId.split(":");
    this.localpart = split[0].substring(1);
    this.host = split[1];
    if (escape) {
        this.escapeUserId();
    }
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
/**
 * Make a userId conform to the matrix spec using QP escaping.
 * Grammar taken from: https://matrix.org/docs/spec/appendices.html#identifier-grammar
 */
MatrixUser.prototype.escapeUserId = function() {
    // Currently Matrix accepts / in the userId, although going forward it will be removed.
    const badChars = new Set(this.localpart.replace(/([A-z0-9]|-|\.|=|_)+/g, ""));
    let res = this.localpart;
    badChars.forEach((c) => {
        const hex = c.charCodeAt(0).toString(16).toLowerCase();
        res = res.replace(
            new RegExp(`\\${c}`, "g"),
            `=${hex}`
        );
    });
    this.localpart = res;
    this.userId = `@${this.localpart}:${this.host}`;
};
/** The MatrixUser class */
module.exports = MatrixUser;
