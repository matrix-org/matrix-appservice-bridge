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

type DataReady = Promise<object>;
type ConsumeCallback = (error: Error|null, data: any) => void;

/**
 * Handles the processing order of incoming Matrix events.
 *
 * Events can be pushed to the queue and will be processed when their
 * corresponding data is ready and they are at the head of line.
 * Different types of queues can be chosen for the processing order of events.
 *
 * Abstract Base Class. Use the factory method `create` to create new instances.
 */
export class EventQueue {
    /**
     * Private constructor.
     *
     * @constructor
     * @param {"none"|"single"|"per_room"} type The type of event queue to create.
     * @param {consumeCallback} consumeFn Function which is called when an event
     *     is consumed.
     */
    private queues: { [identifer: string]: { events: Array<{ dataReady: DataReady }>, consuming: boolean } } = {};
    constructor(private type: "none"|"single"|"per_room",protected consumeFn: ConsumeCallback) {

    }

    /**
     * Push the event and its related data to the queue.
     *
     * @param {IMatrixEvent} event The event to enqueue.
     * @param {Promise<object>} dataReady Promise containing data related to the event.
     */
    public push(event: {room_id: string}, dataReady: DataReady) {
        const queue = this.getQueue(event);
        queue.events.push({
            dataReady: dataReady
        });
    }

    private getQueue(event: {room_id: string}) {
        const identifier = this.type === "per_room" ? event.room_id : "none";
        if (!this.queues[identifier]) {
            this.queues[identifier] = {
                events: [],
                consuming: false
            };
        }
        return this.queues[identifier];
    }

    /**
     * Starts consuming the queue.
     *
     * As long as events are enqueued they will continue to be consumed.
     */
    public consume() {
        Object.keys(this.queues).forEach((identifier) => {
            if (!this.queues[identifier].consuming) {
                this.queues[identifier].consuming = true;
                this.takeNext(identifier);
            }
        });
    }

    private takeNext(identifier: string) {
        const events = this.queues[identifier].events;
        const entry = events.shift();
        if (!entry) {
            this.queues[identifier].consuming = false;
            return;
        }

        Bluebird.resolve(entry.dataReady).asCallback(this.consumeFn);
        entry.dataReady.finally(() => this.takeNext(identifier));
    }

    /**
     * Factory for EventQueues.
     *
     * @param {"none"|"single"|"per_room"} opts.type Type of the queue to create.
     * @param {consumeCallback} consumeFn Function which is called when an event
     *     is consumed.
     * @return {EventQueue} The newly created EventQueue.
     */
    static create(opts: { type: "none"|"single"|"per_room"}, consumeFn: ConsumeCallback) {
        const type = opts.type;
        /* eslint-disable no-use-before-define */
        if (type == "single") {
            return new EventQueueSingle(consumeFn);
        }
        if (type == "per_room") {
            return new EventQueuePerRoom(consumeFn);
        }
        if (type == "none") {
            return new EventQueueNone(consumeFn);
        }
        /* eslint-enable no-use-before-define */
        throw Error(`Invalid EventQueue type '${type}'.`);
    }
}

/**
 * EventQueue for which all events are enqueued in their order of arrival.
 *
 * The foremost event is processed as soon as its data is available.
 */
export class EventQueueSingle extends EventQueue {
    constructor(consumeFn: ConsumeCallback) {
        super("single", consumeFn);
    }
}

/**
 * EventQueue for which one queue per room is utilized.
 *
 * Events at the head of line are processed as soon as their data is available.
 */
export class EventQueuePerRoom extends EventQueue {
    constructor(consumeFn: ConsumeCallback) {
        super("per_room", consumeFn);
    }
}

/**
 * Dummy EventQueue for which no queue is utilized.
 *
 * Every event is handled as soon as its data is available.
 */
export class EventQueueNone extends EventQueue {
    constructor(consumeFn: ConsumeCallback) {
        super("none", consumeFn);
    }

    push(event: unknown, dataReady: DataReady) {
        // consume the event instantly
        Bluebird.resolve(dataReady).asCallback(this.consumeFn);
    }

    consume() {
        // no-op for EventQueueNone
    }
}

/**
 * @callback consumeCallback
 * @param {Error} [err] The error in case the data could not be retrieved.
 * @param {object} data The data associated with the consumed event.
 */