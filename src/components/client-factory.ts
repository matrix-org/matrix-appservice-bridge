/*
Copyright 2020 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

type LogWrapCallback = (err: Error, response: { statusCode: number }, body: any) => void;
type OriginalRequest = (opts: any, cb: LogWrapCallback) => void;

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
export class ClientFactory {
    private clients: { [request_id: string]: { [user_id: string]: any} } = {};
    private sdk: any;
    private clientSchedulerBuilder: () => {};
    private url: string = "";
    private token: string = "";
    private botUserId: string= "";

    constructor(opts: { sdk?: any, url: string, token: string, appServiceUserId: string, clientSchedulerBuilder: any}) {
        opts = opts || {};
        this.sdk = opts.sdk || require("matrix-js-sdk");
        this.clientSchedulerBuilder = opts.clientSchedulerBuilder || function() {};
        this.configure(opts.url, opts.token, opts.appServiceUserId);
    }

    /**
     * Set a function to be called when logging requests and responses.
     * @param {Function} func The function to invoke. The first arg is the string to
     * log. The second arg is a boolean which is 'true' if the log is an error.
     */
    public setLogFunction(func: (msg: string, error?: boolean) => void) {
        if (!func) {
            return;
        }
        this.sdk.wrapRequest((origRequest: OriginalRequest, opts: any, callback: LogWrapCallback) => {
            const logPrefix = (
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
            origRequest(opts, function(err: Error, response: { statusCode: number }, body: any) {
                // Response logging
                const httpCode = response ? response.statusCode : null;
                const responsePrefix = logPrefix + " HTTP " + httpCode;
                if (err) {
                    func(
                        responsePrefix + " Error: " + JSON.stringify(err), true
                    );
                }
                else if (httpCode && (httpCode >= 300 || httpCode < 200)) {
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
    public getClientAs(userId: string, request: any) {
        const reqId = request ? request.getId() : "-";
        const userIdKey = userId || "bot";

        // see if there is an existing match
        let client = this._getClient(reqId, userIdKey);
        if (client) {
            return client;
        }

        // create a new client
        const queryParams: {
            user_id?: string;
            access_token?: string;
        } = {};
        if (userId) {
            queryParams.user_id = userId;
        }
        // force set access_token= so it is used when /register'ing
        queryParams.access_token = this.token;
        const clientOpts = {
            accessToken: this.token,
            baseUrl: this.url,
            userId: userId || this.botUserId, // NB: no clobber so we don't set ?user_id=BOT
            queryParams: queryParams,
            scheduler: this.clientSchedulerBuilder(),
            localTimeoutMs: 1000 * 60 * 2, // Time out CS-API calls after 2mins
        };
        client = this.sdk.createClient(clientOpts);
        client._http.opts._reqId = reqId; // FIXME gut wrenching

        // add a listener for the completion of this request so we can cleanup
        // the clients we've made
        if (request) {
            request.getPromise().finally(() => {
                delete this.clients[reqId];
            });
        }

        // store the new client
        if (!this.clients[reqId]) {
            this.clients[reqId] = {};
        }
        this.clients[reqId][userIdKey] = client;

        return client;
    };

    /**
     * Configure the factory for generating clients.
     * @param {string} baseUrl The base URL to create clients with.
     * @param {string} appServiceToken The AS token to use as the access_token
     * @param {string} appServiceUserId The AS's user_id
     */
    public configure(baseUrl: string, appServiceToken: string, appServiceUserId: string) {
        this.url = baseUrl;
        this.token = appServiceToken;
        this.botUserId = appServiceUserId;
    }

    private _getClient(reqId: string, userId: string) {
        if (this.clients[reqId] && this.clients[reqId][userId]) {
            return this.clients[reqId][userId];
        }
        return null;
    }
}