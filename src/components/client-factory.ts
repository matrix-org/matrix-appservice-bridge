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

type LogWrapCallback = (err: Error, response: { statusCode: number }, body: Record<string, unknown>) => void;
type OriginalRequest = (opts: Record<string, unknown>, cb: LogWrapCallback) => void;

/**
 * @constructor
 * @param opts Options for this factory
 * @param opts.sdk The Matrix JS SDK require() to use.
 * @param opts.url The Client-Server base HTTP URL. This must be set
 * prior to calling getClientAs(). See configure() to set this after instantiation.
 * @param opts.token The application service token to use. This must
 * be set prior to calling getClientAs(). See configure() to set this after
 * instantiation.
 * @param opts.appServiceUserId The application service's user ID. Must
 * be set prior to calling getClientAs(). See configure() to set this after
 * instantiation.
 * @param opts.clientSchedulerBuilder A function that
 * returns a new client scheduler to use in place of the default event
 * scheduler that schedules events to be sent to the HS.
 */

interface ClientFactoryOpts {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sdk?: any;
    url?: string;
    token?: string;
    appServiceUserId?: string;
    clientSchedulerBuilder?: () => unknown;
}

export class ClientFactory {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private clients: { [requestId: string]: { [userId: string]: any} } = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private sdk: any;
    private clientSchedulerBuilder?: () => unknown;
    private url = "";
    private token = "";
    private botUserId= "";

    constructor(opts: ClientFactoryOpts = {}) {
        this.sdk = opts.sdk || require("matrix-js-sdk");
        this.configure(opts.url || "", opts.token || "", opts.appServiceUserId || "");
    }

    /**
     * Set a function to be called when logging requests and responses.
     * @param func The function to invoke. The first arg is the string to
     * log. The second arg is a boolean which is 'true' if the log is an error.
     */
    public setLogFunction(func: (msg: string, error?: boolean) => void) {
        if (!func) {
            return;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
            origRequest(opts, function(err: Error, response: { statusCode: number }, body: Record<string, unknown>) {
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
    }

    /**
     * Construct a new Matrix JS SDK Client. Calling this twice with the same args
     * will return the *same* client instance.
     * @param userId The user_id to scope the client to. A new
     * client will be created per user ID. If this is null, a client scoped to the
     * application service *itself* will be created.
     * @param request The request ID to additionally scope the
     * client to. If set, this will create a new client per user ID / request combo.
     * This factory will dispose the created client instance when the request is
     * resolved.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public getClientAs(userId?: string, request?: any, usingE2E = false) {
        const reqId = request ? request.getId() : "-";
        const userIdKey = userId || "bot";

        // see if there is an existing match
        let client = this._getClient(reqId, userIdKey);
        if (client) {
            return client;
        }

        // create a new client
        const queryParams: {
            // eslint-disable-next-line camelcase
            user_id?: string;
            // eslint-disable-next-line camelcase
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
            scheduler:  this.clientSchedulerBuilder ? this.clientSchedulerBuilder() : undefined,
            usingExternalCrypto: usingE2E,
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
    }

    /**
     * Configure the factory for generating clients.
     * @param baseUrl The base URL to create clients with.
     * @param appServiceToken The AS token to use as the access_token
     * @param appServiceUserId The AS's user_id
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
