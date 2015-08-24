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
    this.userId = userId;
    this.localpart = this.userId.split(":")[0].substring(1);
    if (data) {
        this.deserialize(data);
    }
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
    return this.displayName;
};

/**
 * Set the display name for this Matrix user.
 * @param {string} name The Matrix display name.
 */
MatrixUser.prototype.setDisplayName = function(name) {
    this.displayName = name;
};

/**
 * Serialize all the data about this user, excluding the user ID.
 * @return {Object} The serialised data
 */
MatrixUser.prototype.serialize = function() {
    return {
        displayName: this.displayName,
        localpart: this.localpart
    };
};

MatrixUser.prototype.deserialize = function(data) {
    this.displayName = data.displayName;
};

/** The MatrixUser class */
module.exports = MatrixUser;
