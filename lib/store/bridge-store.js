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

/**
 * Convenience method to convert a document to something.
 * @param {Function} func The function which will be called with a single document
 * object. Guaranteed not to be null.
 * @return {Function} A <code>transformFn</code> function to pass to the standard
 * select/delete/upsert/etc methods.
 */
BridgeStore.prototype.convertTo = function(func) {
    return function(doc) {
        if (!doc) { // findOne query will return 'null' on no matches.
            return null;
        }
        if (Array.isArray(doc)) {
            return doc.map(function(d) {
                return func(d);
            });
        }
        return func(doc);
    };
};

module.exports = BridgeStore;
