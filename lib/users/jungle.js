"use strict";

function JungleUser(identifier, data) {
    if (!identifier) {
        throw new Error("Missing identifier");
    }
    this.id = identifier;
    this.data = data || {};
}

JungleUser.prototype.getId = function() {
    return this.id;
};

JungleUser.prototype.getData = function() {
    return this.data;
}

JungleUser.prototype.get = function(key) {
    return this.data[key];
};

JungleUser.prototype.set = function(key, val) {
    this.data[key] = val;
};

module.exports = JungleUser;
