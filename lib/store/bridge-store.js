"use strict";
var q = require("q");

// wrapper to use promises
var callbackFn = function(d, err, result) {
    if (err) {
        d.reject(err);
    }
    else {
        d.resolve(result);
    }
};

/**
 * Bridge store base class
 * @constructor
 * @param {Datastore} db
 */
function BridgeStore(db) {
    this.db = db;
}

BridgeStore.prototype.insert = function(objects, defer) {
    defer = defer || q.defer();
    this.db.insert(objects, function(err, result) {
        callbackFn(defer, err, result);
    });
    return defer.promise;
};

BridgeStore.prototype.upsert = function(query, updateVals, defer) {
    defer = defer || q.defer();
    this.db.update(query, updateVals, {upsert: true}, function(err, result) {
        callbackFn(defer, err, result);
    });
    return defer.promise;
};

BridgeStore.prototype.update = function(query, updateVals, defer) {
    defer = defer || q.defer();
    this.db.update(query, updateVals, {upsert: false}, function(err, result) {
        callbackFn(defer, err, result);
    });
    return defer.promise;
};

BridgeStore.prototype.delete = function(query, defer) {
    defer = defer || q.defer();
    this.db.remove(query, {multi: true}, function(err, result) {
        callbackFn(defer, err, result);
    });
    return defer.promise;
};

BridgeStore.prototype.selectOne = function(query, transformFn, defer) {
    defer = defer || q.defer();
    this.db.findOne(query, function(err, doc) {
        callbackFn(defer, err, transformFn ? transformFn(doc) : doc);
    });
    return defer.promise;
};

BridgeStore.prototype.select = function(query, transformFn, defer) {
    defer = defer || q.defer();
    this.db.find(query, function(err, docs) {
        callbackFn(defer, err, transformFn ? transformFn(docs) : docs);
    });
    return defer.promise;
};

module.exports = BridgeStore;
