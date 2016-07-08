"use strict";
var Promise = require("bluebird");

/**
 * Construct a new state lookup entity.
 * @constructor
 * @param {Object} opts Options for this constructor
 * @param {MatrixClient} opts.client Required. The client which will perform
 * /state requests.
 * @param {string[]} opts.eventTypes The state event types to track.
 * @throws if there is no client.
 */
function StateLookup(opts) {
    if (!opts.client) {
        throw new Error("opts.client must be supplied");
    }

    this._client = opts.client;
    this._eventTypes = opts.eventTypes || [];
    this._dict = {
        // $room_id: {
        //   syncPromise: Promise,
        //   events: {
        //     $event_type: {
        //       $state_key: { Event }
        //     }
        //   }
        // }
    };
}

/**
 * Get a stored state event.
 *
 * @param {string} roomId
 * @param {string} eventType
 * @param {string=} stateKey If specified, this function will return either
 * the event or null. If not specified, this function will always return an
 * array of events, which may be empty.
 * @return {?Object|Object[]}
 */
StateLookup.prototype.getState = function(roomId, eventType, stateKey) {
    var r = this._dict[roomId];
    if (!r) {
        return stateKey ? null : [];
    }
    var es = r.events;
    if (!es[eventType]) {
        return stateKey ? null : [];
    }
    if (stateKey) {
        return es[eventType][stateKey] || null;
    }

    return Object.keys(es[eventType]).map(function(skey) {
        return es[eventType][skey];
    });
};

/**
 * Track a given room. The client must have access to this room.
 *
 * This will perform a room state query initially. Subsequent calls will do
 * nothing, as it will rely on events being pushed to it via {@link StateLookup#onEvent}.
 *
 * @return {Promise} Resolves when the room is being tracked. Rejects if the room
 * cannot be tracked.
 */
StateLookup.prototype.trackRoom = function(roomId) {
    this._dict[roomId] = this._dict[roomId] || {};
    if (this._dict[roomId].syncPromise) {
        return this._dict[roomId].syncPromise;
    }
    var self = this;
    this._dict[roomId].events = {};
    this._dict[roomId].syncPromise = new Promise(function(resolve, reject) {
        // convoluted query function so we can do retries on errors
        var queryRoomState = function() {
            self._client.roomState(roomId).then(function(events) {
                events.forEach(function(ev) {
                    if (self._eventTypes[ev.type]) {
                        if (!self._dict[roomId].events[ev.type]) {
                            self._dict[roomId].events[ev.type] = {};
                        }
                        self._dict[roomId].events[ev.type][ev.state_key] = ev;
                    }
                });
                resolve();
            }, function(err) {
                if (err.httpStatus >= 400 && err.httpStatus < 600) { // 4xx, 5xx
                    reject(err); // don't have permission, don't retry.
                }
                // wait a bit then try again
                Promise.delay(3000).then(function() {
                    queryRoomState();
                });
            });
        };
        queryRoomState();
    });
    return this._dict[roomId].syncPromise;
};

/**
 * Update any state dictionaries with this event. If there is nothing tracking
 * this room, nothing is stored.
 * @param {Object} event Raw matrix event
 */
StateLookup.prototype.onEvent = function(event) {
    if (!this._dict[event.room_id]) {
        return;
    }
    var r = this._dict[event.room_id];
    if (r.syncPromise.isPending()) {
        // well this is awkward. We're being pushed events whilst we have
        // a /state request ongoing. We always expect to be notified of the
        // latest state via push, so if we ignore the /state response for this
        // event and always use the pushed events we should remain in sync.
        // we'll add our own listener for the sync promise and then update this
        // value.
        r.syncPromise.then(function() {
            if (!r.events[event.type]) {
                r.events[event.type] = {};
            }
            r.events[event.type][event.state_key] = event;
        });
        return;
    }
    // blunt update
    if (!r.events[event.type]) {
        r.events[event.type] = {};
    }
    r.events[event.type][event.state_key] = event;
};
