/**
 * Handles the processing order of incoming Matrix events.
 *
 * Events can be pushed to the queue and will be processed when their
 * corresponding data is ready and they are at the head of line.
 * Different types of queues can be chosen for the processing order of events.
 *
 * Abstract Base Class. Use the factory method `create` to create new instances.
 */
class EventQueue {
    /**
     * Private constructor.
     *
     * @constructor
     * @param {"none"\|"single"\|"per_room"} type The type of event queue to create.
     * @param {consumeCallback} consumeFn Function which is called when an event
     *     is consumed.
     */
    constructor(type, consumeFn) {
        this.type = type;
        this._queues = {
            // $identifier: {
            //  events: [ {dataReady: } ],
            //  consuming: true|false
            // }
        };
        this.consumeFn = consumeFn;
    }

    /**
     * Push the event and its related data to the queue.
     *
     * @param {IMatrixEvent} event The event to enqueue.
     * @param {Promise<object>} dataReady Promise containing data related to the event.
     */
    push(event, dataReady) {
        const queue = this._getQueue(event);
        queue.events.push({
            dataReady: dataReady
        });
    }

    _getQueue(event) {
        const identifier = this.type === "per_room" ? event.room_id : "none";
        if (!this._queues[identifier]) {
            this._queues[identifier] = {
                events: [],
                consuming: false
            };
        }
        return this._queues[identifier];
    }

    /**
     * Starts consuming the queue.
     *
     * As long as events are enqueued they will continue to be consumed.
     */
    consume() {
        Object.keys(this._queues).forEach((identifier) => {
            if (!this._queues[identifier].consuming) {
                this._queues[identifier].consuming = true;
                this._takeNext(identifier);
            }
        });
    }

    _takeNext(identifier) {
        const events = this._queues[identifier].events;
        if (events.length === 0) {
            this._queues[identifier].consuming = false;
            return;
        }
        const entry = events.shift();

        entry.dataReady.asCallback(this.consumeFn);
        entry.dataReady.finally(() => this._takeNext(identifier));
    }

    /**
     * Factory for EventQueues.
     *
     * @param {"none"\|"single"\|"per_room"} opts.type Type of the queue to create.
     * @param {consumeCallback} consumeFn Function which is called when an event
     *     is consumed.
     * @return {EventQueue} The newly created EventQueue.
     */
    static create(opts, consumeFn) {
        const type = opts.type;
        if (type == "single") {
            return new EventQueueSingle(consumeFn);
        }
        if (type == "per_room") {
            return new EventQueuePerRoom(consumeFn);
        }
        if (type == "none") {
            return new EventQueueNone(consumeFn);
        }
        throw Error(`Invalid EventQueue type '${type}'.`);
    }
}

/**
 * EventQueue for which all events are enqueued in their order of arrival.
 *
 * The foremost event is processed as soon as its data is available.
 */
class EventQueueSingle extends EventQueue {
    constructor(consumeFn) {
        super("single", consumeFn);
    }
}

/**
 * EventQueue for which one queue per room is utilized.
 *
 * Events at the head of line are processed as soon as their data is available.
 */
class EventQueuePerRoom extends EventQueue {
    constructor(consumeFn) {
        super("per_room", consumeFn);
    }
}

/**
 * Dummy EventQueue for which no queue is utilized.
 *
 * Every event is handled as soon as its data is available.
 */
class EventQueueNone extends EventQueue {
    constructor(consumeFn) {
        super("none", consumeFn);
    }

    push(event, data, promise) {
        // consume the event instantly
        promise.asCallback(this.consumeFn);
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

module.exports = {
    EventQueue,
    EventQueueSingle,
    EventQueuePerRoom,
    EventQueueNone,
};
