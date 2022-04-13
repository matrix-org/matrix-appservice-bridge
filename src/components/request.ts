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

import { defer, Defer } from "../utils/promiseutil";

function generateRequestId() {
    return (Math.random() * 1e20).toString(36);
}

export interface RequestOpts<T> {
    id?: string;
    data?: T;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class Request<T, R extends any = any> {
    private id: string;
    private data: T|null;
    private startTs: number;
    private defer: Defer<R>;
    private pending: boolean;

    public get isPending(): boolean {
        return this.pending;
    }

    /**
     * Construct a new Request.
     * @param opts Options for this request.
     * @param opts.id Optional ID to set on this request. One will be
     * generated if this is not provided.
     * @param opts.data Optional data to associate with this request.
     */
    constructor(opts: RequestOpts<T> = { }) {
        this.id = opts.id || generateRequestId();
        this.data = opts.data || null;
        this.startTs = Date.now();
        this.defer = defer();
        this.pending = true;
    }


    /**
     * Get any optional data set on this request.
     * @return The data
     */
    public getData(): T|null {
        return this.data;
    }

    /**
     * Get this request's ID.
     * @return The ID.
     */
    public getId(): string {
        return this.id;
    }

    /**
     * Get the number of elapsed milliseconds since this request was created.
     * @return The number of milliseconds since this request was made.
     */
    public getDuration(): number {
        return Date.now() - this.startTs;
    }

    /**
     * Retrieve a promise for this request which will be resolved/rejected when the
     * respective methods are called on this Request.
     * @return {Promise} A promise
     */
    public getPromise(): Promise<R> {
        return this.defer.promise;
    }

    /**
     * Resolve a request. This should be invoked for the <i>successful processing</i>
     * of this request. This doesn't necessarily mean that the request was sent
     * through, e.g. suppressing AS virtual users' messages is still a success.
     * @param msg The thing to resolve with.
     */
    public resolve(msg: R): void {
        this.pending = false;
        this.defer.resolve(msg);
    }

    /**
     * Reject a request. This should be invoked for requests which <i>failed to be
     * processed correctly</i>.
     * @param msg The thing to reject with.
     */
    public reject(msg: unknown): void {
        this.pending = false;
        this.defer.reject(msg);
    }

    /**
     * Resolve or reject the promise depending on the outcome of this promise.
     * @param promise The promise whose resolution determines the outcome of this
     * request.
     */
    public outcomeFrom(promise: Promise<R>): Promise<unknown> {
        return promise.then(this.resolve.bind(this), this.reject.bind(this));
    }
}
