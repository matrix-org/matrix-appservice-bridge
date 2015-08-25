"use strict";
var requestModule = require("request");

/**
 * @constructor
 * @param {Object} opts Options for this factory
 * @param {*=} opts.sdk The Matrix JS SDK require() to use.
 * @param {string=} opts.url The Client-Server base HTTP URL
 * @param {string=} opts.token The application service token to use.
 */
function ClientFactory(opts) {
    opts = opts || {};
    this._sdk = opts.sdk || require("matrix-js-sdk");
    this._url = opts.url;
    this._token = opts.token;
    this._clients = {
    //  request_id: {
    //      user_id: Client
    //  }
    };
}

/**
 * Set a function to be called when logging requests and responses.
 * @param {Function} func The function to invoke. The first arg is the string to
 * log. The second arg is a boolean which is 'true' if the log is an error.
 */
ClientFactory.prototype.setLogFunction = function(func) {
    if (func) {
        this._sdk.request(function(opts, callback) {
            var logPrefix = (
                (opts._matrix_opts && opts._matrix_opts._reqId ?
                    "[" + opts._matrix_opts._reqId + "] " : ""
                ) +
                opts.method + " " + opts.uri + " " +
                (opts.qs.user_id ? "(" + opts.qs.user_id + ")" : "(AS)")
            );
            // Request logging
            func(
                logPrefix + " Body: " +
                (opts.body ? JSON.stringify(opts.body).substring(0, 80) : "")
            );
            // Make the request
            requestModule(opts, function(err, response, body) {
                // Response logging
                var httpCode = response ? response.statusCode : null;
                var responsePrefix = logPrefix + " HTTP " + httpCode;
                if (err) {
                    func(
                        responsePrefix + " Error: " + JSON.stringify(err), true
                    );
                    return;
                }
                if (httpCode >= 300 || httpCode < 200) {
                    func(
                        responsePrefix + " Error: " + JSON.stringify(body), true
                    );
                }
                else {
                    func( // body may be large, so do first 80 chars
                        responsePrefix + " " +
                        JSON.stringify(body).substring(0, 80)
                    );
                }
                // Invoke the callback
                callback(err, response, body);
            });
        });
    }
};

/**
 * Construct a new Matrix JS SDK Client. Calling this twice with the same args
 * will return the *same* client instance.
 * @param {?string} userId Required. The user_id to scope the client to. A new
 * client will be created per user ID. If this is null, a client scoped to the
 * application service *itself* will be created.
 * @param {Request=} request Optional. The request ID to additionally scope the
 * client to. If set, this will create a new client per user ID / request combo.
 * This factory will dispose the created client instance when the request is
 * resolved.
 */
ClientFactory.prototype.getClientAs = function(userId, request) {
    var reqId = request ? request.getId() : "-";
    var userIdKey = userId || "bot";
    var self = this;

    // see if there is an existing match
    var client = this._getClient(reqId, userIdKey);
    if (client) {
        return client;
    }

    // create a new client
    var queryParams = {};
    if (userId) {
        queryParams.user_id = userId;
    }
    // force set access_token= so it is used when /register'ing
    queryParams.access_token = this._token;
    client = this._sdk.createClient({
        accessToken: this._token,
        baseUrl: this._url,
        userId: userId,
        queryParams: queryParams
    });
    client._http.opts._reqId = reqId; // FIXME gut wrenching

    // add a listener for the completion of this request so we can cleanup
    // the clients we've made
    if (request) {
        request.getPromise().finally(function() {
            delete self._clients[reqId];
        });
    }

    // store the new client
    if (!this._clients[reqId]) {
        this._clients[reqId] = {};
    }
    this._clients[reqId][userIdKey] = client;

    return client;
};

/**
 * Configure the factory for generating clients.
 * @param {string} baseUrl The base URL to create clients with.
 * @param {string} appServiceToken The AS token to use as the access_token
 */
ClientFactory.prototype.configure = function(baseUrl, appServiceToken) {
    this._url = baseUrl;
    this._token = appServiceToken;
};

ClientFactory.prototype._getClient = function(reqId, userId) {
    if (this._clients[reqId] && this._clients[reqId][userId]) {
        return this._clients[reqId][userId];
    }
    return null;
};

module.exports = ClientFactory;
