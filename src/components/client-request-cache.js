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

/**
 * Caches requests in memory and handles expiring them.
 */
class ClientRequestCache {
    /**
     * @param ttl {Number} How old a result can be before it gets expired.
     * @param size {Number} How many results to store before we trim.
     * @param requestFunc The function to use on cache miss.
     */
    constructor (ttl, size, requestFunc) {
        if (!Number.isInteger(ttl) || ttl <= 0) {
            throw Error("'ttl' must be greater than 0");
        }
        if (!Number.isInteger(size) || ttl <= 0) {
            throw Error("'size' must be greater than 0");
        }
        if (typeof(requestFunc) !== "function") {
            throw Error("'requestFunc' must be a function");
        }
        this._requestContent = new Map(); // key => {ts, content}
        this.requestFunc = requestFunc;
        this.ttl = ttl;
        this.maxSize = size;
    }

    /**
     * Gets a result of a request from the cache, or otherwise
     * tries to fetch the the result with this.requestFunc
     *
     * @param {string}} key Key of the item to get/store.
     * @param {any[]} args A set of arguments to pass to the request func.
     * @returns {Promise} The request, or undefined if not retrievable.
     * @throws {Error} If the key is not a string.
     */
    get(key, ...args) {
        if (typeof(key) !== "string") {
            throw Error("'key' must be a string");
        }
        const cachedResult = this._requestContent.get(key);
        if (cachedResult !== undefined && cachedResult.ts >= Date.now() - this.ttl) {
            return cachedResult.content;
        }
        // Delete the old req.
        this._requestContent.delete(key);
        return new Promise((resolve, reject) => {
            resolve(this.requestFunc.apply(null, [key].concat(args)))
        }).then((result) => {
            if (result !== undefined) {
                this._requestContent.set(key, {
                    ts: Date.now(),
                    content: result,
                });
                if (this._requestContent.size > this.maxSize) {
                    const oldKey = this._requestContent.keys().next().value;
                    this._requestContent.delete(oldKey);
                }
            }
            return result;
        });
        // Not catching here because we want to pass
        // through any failures.
    }

    /**
     * Clone the current request result cache, mapping keys to their cache records.
     * @returns {Map<string,any>}
     */
    getCachedResults() {
        return new Map(this._requestContent);
    }

    /**
     * @callback requestFunc
     * @param {any[]} args A set of arguments passed from get().
     * @param {string} key The key for the cached item.
     */
}

module.exports = ClientRequestCache;
