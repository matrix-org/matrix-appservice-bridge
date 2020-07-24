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
import Bluebird from "bluebird";
import PQueue from "p-queue";

interface StateLookupOpts {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: any; //TODO: Needs to be MatrixClient (once that becomes TypeScript)
    stateLookupConcurrency: number;
    eventTypes?: string[];
    retryStateInMs?: number;
}

interface StateLookupRoom {
    syncPromise: Bluebird<StateLookupRoom>;
    syncComplete: boolean;
    events: {
        [eventType: string]: {
            [stateKey: string]: StateLookupEvent;
        };
    };
}

interface StateLookupEvent {
    // eslint-disable-next-line camelcase
    room_id: string;
    // eslint-disable-next-line camelcase
    state_key: string;
    type: string;
    // eslint-disable-next-line camelcase
    event_id: string;
}

const RETRY_STATE_IN_MS = 300;
const DEFAULT_STATE_CONCURRENCY = 4;

export class StateLookup {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private _client: any;
    private eventTypes: {[eventType: string]: boolean} = {};
    private dict: { [roomId: string]: StateLookupRoom } = {};
    private lookupQueue: PQueue;
    private retryStateIn: number;

    /**
     * Construct a new state lookup entity.
     *
     * This component stores state events for specific event types which can be
     * queried at a later date. This component will perform network requests to
     * fetch the current state for a given room ID. It relies on
     * {@link StateLookup#onEvent} being called with later events in order to
     * stay up-to-date. This should be connected to the <code>onEvent</code>
     * handler on the {@link Bridge}.
     * @constructor
     * @param {Object} opts Options for this constructor
     * @param {MatrixClient} opts.client Required. The client which will perform
     * /state requests.
     * @param {string[]} opts.eventTypes The state event types to track.
     * @throws if there is no client.
     */
    constructor (opts: StateLookupOpts) {
        if (!opts.client) {
            throw new Error("client property must be supplied");
        }

        this.lookupQueue = new PQueue({
            concurrency: opts.stateLookupConcurrency || DEFAULT_STATE_CONCURRENCY,
        });

        this.retryStateIn = opts.retryStateInMs || RETRY_STATE_IN_MS;

        this._client = opts.client;
        (opts.eventTypes || []).forEach((t) => {
            this.eventTypes[t] = true;
        });
    }

    /**
     * Get a stored state event.
     * @param {string} roomId
     * @param {string} eventType
     * @param {string=} stateKey If specified, this function will return either
     * the event or null. If not specified, this function will always return an
     * array of events, which may be empty.
     * @return {?Object|Object[]}
     */
    public getState(roomId: string, eventType: string, stateKey?: string): unknown|unknown[] {
        const r = this.dict[roomId];
        if (!r) {
            return stateKey === undefined ? [] : null;
        }
        const es = r.events;
        if (!es[eventType]) {
            return stateKey === undefined ? [] : null;
        }
        if (stateKey !== undefined) {
            return es[eventType][stateKey] || null;
        }

        return Object.keys(es[eventType]).map(function(skey) {
            return es[eventType][skey];
        });
    }

    private async getInitialState(roomId: string): Promise<StateLookupRoom> {
        const r = this.dict[roomId];
        try {
            const events: StateLookupEvent[] = await this.lookupQueue.add(
                () => this._client.roomState(roomId)
            );
            events.forEach((ev) => {
                if (this.eventTypes[ev.type]) {
                    if (!r.events[ev.type]) {
                        r.events[ev.type] = {};
                    }
                    r.events[ev.type][ev.state_key] = ev;
                }
            });
            return r;
        }
        catch (err) {
            if (err.httpStatus >= 400 && err.httpStatus < 600) { // 4xx, 5xx
                throw err; // don't have permission, don't retry.
            }
            // wait a bit then try again
            await new Promise((resolve) => setTimeout(resolve, this.retryStateIn));
        }
        return this.getInitialState(roomId);
    }

    /**
     * Track a given room. The client must have access to this room.
     *
     * This will perform a room state query initially. Subsequent calls will do
     * nothing, as it will rely on events being pushed to it via {@link StateLookup#onEvent}.
     *
     * @param {string} roomId The room ID to start tracking. You can track multiple
     * rooms by calling this function multiple times with different room IDs.
     * @return {Promise} Resolves when the room is being tracked. Rejects if the room
     * cannot be tracked.
     */
    public trackRoom(roomId: string) {
        const r = this.dict[roomId] = this.dict[roomId] || {};
        if (r.syncPromise) {
            return r.syncPromise;
        }
        r.events = {};
        // For backwards compat, we use Bluebird
        r.syncPromise = Bluebird.resolve(this.getInitialState(roomId));

        return r.syncPromise;
    }

    /**
     * Stop tracking a given room.
     *
     * This will stop further tracking of state events in the given room and delete
     * existing stored state for it.
     *
     * @param {string} roomId The room ID to stop tracking.
     */
    public untrackRoom(roomId: string) {
        delete this.dict[roomId];
    }

    /**
     * Update any state dictionaries with this event. If there is nothing tracking
     * this room, nothing is stored.
     * @param {Object} event Raw matrix event
     */
    public async onEvent(event: StateLookupEvent) {
        if (!this.dict[event.room_id]) {
            return;
        }
        let r = this.dict[event.room_id];
        // Ensure /sync has completed before trying to update.
        if (r.syncPromise.isPending()) {
            r = await r.syncPromise;
        }

        // blunt update
        if (!r.events[event.type]) {
            r.events[event.type] = {};
        }
        r.events[event.type][event.state_key] = event;
    }
}
