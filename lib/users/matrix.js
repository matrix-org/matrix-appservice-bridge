"use strict";

function MatrixUser(userId) {
    if (!userId) {
        throw new Error("Missing user_id");
    }
    this.userId = userId;
}

MatrixUser.prototype.getId = function() {
    return this.userId;
};

MatrixUser.prototype.setDisplayName = function(name) {
    this.displayName = name;
};

MatrixUser.prototype.getData = function() {
    return {
        displayName: this.displayName
    };
};

module.exports = MatrixUser;
