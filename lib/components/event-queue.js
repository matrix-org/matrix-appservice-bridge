class EventQueue {
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

class EventQueueSingle extends EventQueue {
    constructor(consumeFn) {
        super("single", consumeFn);
    }
}

class EventQueuePerRoom extends EventQueue {
    constructor(consumeFn) {
        super("per_room", consumeFn);
    }
}

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

module.exports = {
    EventQueue,
    EventQueueSingle,
    EventQueuePerRoom,
    EventQueueNone,
};
