"use strict";

/**
 * @constructor
 * @param {Object} opts Options for this factory
 * @param {*=} opts.sdk The Matrix JS SDK require() to use.
 * @param {string=} opts.url The Client-Server base HTTP URL. This must be set
 * prior to calling getClientAs(). See configure() to set this after instantiation.
 * @param {string=} opts.token The application service token to use. This must
 * be set prior to calling getClientAs(). See configure() to set this after
 * instantiation.
 * @param {string=} opts.appServiceUserId The application service's user ID. Must
 * be set prior to calling getClientAs(). See configure() to set this after
 * instantiation.
 * @param {function=} opts.clientSchedulerBuilder Optional. A function that
 * returns a new client scheduler to use in place of the default event
 * scheduler that schedules events to be sent to the HS.
 */
function ClientFactory(opts) {
    opts = opts || {};
    this._sdk = opts.sdk || require("matrix-js-sdk");
    this._clients = {
    //  request_id: {
    //      user_id: Client
    //  }
    };
    this._clientSchedulerBuilder = opts.clientSchedulerBuilder || function() {};
    this.configure(opts.url, opts.token, opts.appServiceUserId);
}

/**
 * Set a function to be called when logging requests and responses.
 * @param {Function} func The function to invoke. The first arg is the string to
 * log. The second arg is a boolean which is 'true' if the log is an error.
 */
ClientFactory.prototype.setLogFunction = function(func) {
    if (!func) {
        return;
    }
    this._sdk.wrapRequest(function(origRequest, opts, callback) {
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
        origRequest(opts, function(err, response, body) {
            // Response logging
            var httpCode = response ? response.statusCode : null;
            var responsePrefix = logPrefix + " HTTP " + httpCode;
            if (err) {
                func(
                    responsePrefix + " Error: " + JSON.stringify(err), true
                );
            }
            else if (httpCode >= 300 || httpCode < 200) {
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
    var clientOpts = {
        accessToken: this._token,
        baseUrl: this._url,
        userId: userId || this._botUserId, // NB: no clobber so we don't set ?user_id=BOT
        queryParams: queryParams,
        scheduler: this._clientSchedulerBuilder(),
        localTimeoutMs: 1000 * 60 * 2, // Time out CS-API calls after 2mins
    };
    client = this._sdk.createClient(clientOpts);
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
 * @param {string} appServiceUserId The AS's user_id
 */
ClientFactory.prototype.configure = function(baseUrl, appServiceToken, appServiceUserId) {
    this._url = baseUrl;
    this._token = appServiceToken;
    this._botUserId = appServiceUserId;
};

ClientFactory.prototype._getClient = function(reqId, userId) {
    if (this._clients[reqId] && this._clients[reqId][userId]) {
        return this._clients[reqId][userId];
    }
    return null;
};

module.exports = ClientFactory;
