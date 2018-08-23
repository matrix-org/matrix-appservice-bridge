/**
 * Caches requests in memory and handles expiring them.
 */
class ClientRequestCache {
    /**
     * @param ttl {Number} How old a request can be before it gets expired.
     * @param requestFunc The function to use when requesting.
     */
    constructor (ttl, requestFunc) {
        if (!Number.isInteger(ttl) || ttl <= 0) {
            throw Error("'ttl' must be greater than 0");
        }
        if (typeof(requestFunc) !== "function") {
            throw Error("'requestFunc' must be a function");
        }
        this._requestContent = new Map(); // key => {ts, content}
        this.requestFunc = requestFunc;
        this.ttl = ttl;
    }

    /**
     * Get's a result of a request from the cache, or otherwise
     * tries to fetch the the result with this.requestFunc
     *
     * @param {string}} key Key of the item to get/store.
     * @param {any[]=[]} args A set of arguments to pass to the request func.
     * @returns {Promise} The request, or undefined if not retrievable.
     */
    get(key, ...args) {
        const cachedResult = this._requestContent.get(key)
        if (cachedResult !== undefined && cachedResult.ts >= Date.now() - this.ttl) {
            return cachedResult.content;
        }
        return Promise.resolve(
            this.requestFunc.apply(null, [key].concat(args))
        ).then((result) => {
            if (result !== undefined) {
                this._requestContent.set(key, {
                    ts: Date.now(),
                    content: result,
                });
            }
            return result;
        }).catch((err) => {
            // If the request failed for any reason we want to delete it.
            this._requestContent.delete(key);
            throw err;
        });
    }

    /**
     * @callback requestFunc
     * @param {any[]} args A set of arguments passed from get().
     * @param {string} key The key for the cached item.
     */
}

module.exports = ClientRequestCache;