"use strict";
var Promise = require("bluebird");

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

/**
 * INSERT a multiple documents.
 * @param {Object} objects
 * @param {Deferred=} defer
 * @return {Promise}
 */
BridgeStore.prototype.insert = function(objects, defer) {
    defer = defer || new Promise.defer();
    this.db.insert(objects, function(err, result) {
        callbackFn(defer, err, result);
    });
    return defer.promise;
};

/**
 * UPSERT a single document.
 * @param {Object} query
 * @param {Object} updateVals
 * @param {Deferred=} defer
 * @return {Promise}
 */
BridgeStore.prototype.upsert = function(query, updateVals, defer) {
    defer = defer || new Promise.defer();
    this.db.update(query, updateVals, {upsert: true}, function(err, result) {
        callbackFn(defer, err, result);
    });
    return defer.promise;
};

/**
 * INSERT IF NOT EXISTS a single document.
 * @param {Object} query
 * @param {Object} insertObj
 * @return {Promise}
 */
BridgeStore.prototype.insertIfNotExists = function(query, insertObj) {
    var self = this;
    return self.selectOne(query).then(function(doc) {
        if (doc) {
            return Promise.resolve();
        }
        return self.insert(insertObj);
    });
};

/**
 * UPDATE a single document. If the document already exists, this will NOT update
 * it.
 * @param {Object} query
 * @param {Object} updateVals
 * @param {Deferred=} defer
 * @return {Promise}
 */
BridgeStore.prototype.update = function(query, updateVals, defer) {
    defer = defer || new Promise.defer();
    this.db.update(query, updateVals, {upsert: false}, function(err, result) {
        callbackFn(defer, err, result);
    });
    return defer.promise;
};

/**
 * DELETE multiple documents.
 * @param {Object} query
 * @param {Deferred=} defer
 * @return {Promise}
 */
BridgeStore.prototype.delete = function(query, defer) {
    defer = defer || new Promise.defer();
    this.db.remove(query, {multi: true}, function(err, result) {
        callbackFn(defer, err, result);
    });
    return defer.promise;
};

/**
 * SELECT a single document.
 * @param {Object} query
 * @param {Function} transformFn
 * @param {Deferred=} defer
 * @return {Promise}
 */
BridgeStore.prototype.selectOne = function(query, transformFn, defer) {
    defer = defer || new Promise.defer();
    this.db.findOne(query, function(err, doc) {
        callbackFn(defer, err, transformFn ? transformFn(doc) : doc);
    });
    return defer.promise;
};

/**
 * SELECT a number of documents.
 * @param {Object} query
 * @param {Function} transformFn
 * @param {Deferred=} defer
 * @return {Promise}
 */
BridgeStore.prototype.select = function(query, transformFn, defer) {
    defer = defer || new Promise.defer();
    this.db.find(query, function(err, docs) {
        callbackFn(defer, err, transformFn ? transformFn(docs) : docs);
    });
    return defer.promise;
};

/**
 * Set a UNIQUE key constraint on the given field.
 * @param {string} fieldName The field name. Use dot notation for nested objects.
 * @param {boolean} sparse Allow sparse entries (undefined won't cause a key
 * violation). Default: false.
 */
BridgeStore.prototype.setUnique = function(fieldName, sparse) {
    sparse = sparse || false;
    this.db.ensureIndex({
        fieldName: fieldName,
        unique: true,
        sparse: sparse
    });
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
