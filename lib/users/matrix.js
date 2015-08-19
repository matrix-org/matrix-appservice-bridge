"use strict";

/**
 * Construct a Matrix user.
 * @constructor
 * @param {string} userId The user_id of the user.
 */
function MatrixUser(userId) {
    if (!userId) {
        throw new Error("Missing user_id");
    }
    this.userId = userId;
}

/**
 * Get the matrix user's ID.
 * @return {string} The user ID
 */
MatrixUser.prototype.getId = function() {
    return this.userId;
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
MatrixUser.prototype.getData = function() {
    return {
        displayName: this.displayName
    };
};

/** The MatrixUser class */
module.exports = MatrixUser;
