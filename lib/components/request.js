"use strict";
var Promise = require("bluebird");

function generateRequestId() {
    return (Math.random() * 1e20).toString(36);
}

/**
 * Construct a new Request.
 * @constructor
 * @param {Object} opts Options for this request.
 * @param {string=} opts.id Optional ID to set on this request. One will be
 * generated if this is not provided.
 * @param {*=} opts.data Optional data to associate with this request.
 */
function Request(opts) {
    opts = opts || {};
    this.id = opts.id || generateRequestId();
    this.data = opts.data;
    this.startTs = Date.now();
    this.defer = new Promise.defer();
}

/**
 * Get any optional data set on this request.
 * @return {*} The data
 */
Request.prototype.getData = function() {
    return this.data;
}

/**
 * Get this request's ID.
 * @return {String} The ID.
 */
Request.prototype.getId = function() {
    return this.id;
}

/**
 * Get the number of elapsed milliseconds since this request was created.
 * @return {number} The number of milliseconds since this request was made.
 */
Request.prototype.getDuration = function() {
    return Date.now() - this.startTs;
};

/**
 * Retrieve a promise for this request which will be resolved/rejected when the
 * respective methods are called on this Request.
 * @return {Promise} A promise
 */
Request.prototype.getPromise = function() {
    return this.defer.promise;
};

/**
 * Resolve a request. This should be invoked for the <i>successful processing</i>
 * of this request. This doesn't necessarily mean that the request was sent
 * through, e.g. suppressing AS virtual users' messages is still a success.
 * @param {*} msg The thing to resolve with.
 */
Request.prototype.resolve = function(msg) {
    this.defer.resolve(msg);
};

/**
 * Reject a request. This should be invoked for requests which <i>failed to be
 * processed correctly</i>.
 * @param {*} msg The thing to reject with.
 */
Request.prototype.reject = function(msg) {
    this.defer.reject(msg);
};

/**
 * Resolve or reject the promise depending on the outcome of this promise.
 * @param {Promise} The promise whose resolution determines the outcome of this
 * request.
 */
Request.prototype.outcomeFrom = function(promise) {
    var self = this;
    promise.done(function(r) {
        self.resolve(r);
    }, function(e) {
        self.reject(e);
    });
};

module.exports = Request;
