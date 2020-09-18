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

import { Request, RequestOpts } from "./request";

type HandlerFunction = (req: Request<unknown>, value: unknown) => Promise<unknown>|unknown;
type TimeoutFunction = (req: Request<unknown>) => void;

/**
 * A factory which can create {@link Request} objects. Useful for
 * adding "default" handlers to requests.
 */
export class RequestFactory {
    private _resolves: HandlerFunction[] = [];
    private _rejects: HandlerFunction[] = [];
    private _timeouts: {fn: TimeoutFunction, timeout: number}[] = [];


    /**
     * Generate a new request.
     * @param opts The options to pass to the Request constructor, if any.
     * @return A new request object
     */
    public newRequest<T>(opts: RequestOpts<T>) {
        const req = new Request(opts);
        req.getPromise().then((res) => {
            this._resolves.forEach((resolveFn) => {
                resolveFn(req, res);
            });
        }).catch((err) => {
            this._rejects.forEach((rejectFn) => {
                rejectFn(req, err);
            });
        });

        this._timeouts.forEach(function(timeoutObj) {
            setTimeout(function() {
                if (!req.isPending) {
                    return;
                }
                timeoutObj.fn(req);
            }, timeoutObj.timeout);
        });
        return req;
    }

    /**
     * Add a function which will be invoked for every request that is resolved.
     * @param fn The function to invoke. The first argument will be the
     * Request object, the second will be the resolve argument.
     */
    public addDefaultResolveCallback(fn: HandlerFunction) {
        this._resolves.push(fn);
    }

    /**
     * Add a function which will be invoked for every request that is rejected.
     * @param fn The function to invoke. The first argument will be the
     * Request object, the second will be the rejection argument.
     */
    public addDefaultRejectCallback(fn: HandlerFunction) {
        this._rejects.push(fn);
    }

    /**
     * Add a function which will be invoked for every request that has not been
     * resolved or rejected within a certain amount of time.
     * @param fn The function to invoke. The first argument will be the
     * Request object.
     * @param durationMs The number of milliseconds to wait for a
     * resolution to the request.
     */
    public addDefaultTimeoutCallback(fn: TimeoutFunction, durationMs: number) {
        this._timeouts.push({
            fn: fn,
            timeout: durationMs
        });
    }
}
