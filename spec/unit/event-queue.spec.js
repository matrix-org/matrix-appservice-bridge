"use strict";
const log = require("../log");

const EventQueue = require("../../lib/components/event-queue").EventQueue;


// HELPER FUNCTIONS


const SLEEP_TIME = 200; // ms
const TOLERANCE = 20; // ms


var customMatchers = {
    toLast: function() {
        return {
            compare: function(duration, timesteps) {
                const expectedDuration = SLEEP_TIME * timesteps;
                const tolerance = TOLERANCE * timesteps;
                const timeDifference = Math.abs(duration - expectedDuration);
                return {
                    pass:  timeDifference < tolerance,
                    message: (
                        `Expected duration to be ` +
                        `${expectedDuration}±${tolerance}, but was ${duration}.`
                    ),
                };
            }
        }
    },
};


async function getValueDelayed(value, timesteps) {
    return new Promise(resolve =>
        setTimeout(() => resolve(value), timesteps * SLEEP_TIME)
    );
}


function timeRangeData(i, j, data) {
    const time1 = data[i][0];
    const time2 = data[j][0];

    if (time1 > time2) {
        // The happy path doesn't need an abs now :)
        throw Error("time1 before time2");
    }
    return time2 - time1
}


// UNIT TESTS


const eventRoomA = {room_id: "!A:room.org"}
const eventRoomB = {room_id: "!B:room.org"}


describe("EventQueue", function() {
    let queue;
    let callbackData; // array of (time, data) tuples, [0] is (start time, null)
    let timeRange;
    let addedDataCallback;
    let errorCallback;

    function eventQueueCallback(err, data) {
        if (err) {
            errorCallback(err);
            return;
        }
        callbackData.push([new Date().getTime(), data]);
        addedDataCallback(data);
    }

    beforeEach(
    /** @this */
    function() {
        log.beforeEach(this);
        jasmine.addMatchers(customMatchers);

        callbackData = [[new Date().getTime(), null]];
        timeRange = (i, j) => timeRangeData(i, j, callbackData);
    });

    // Those two tests are not required if the type signature of `create` is respected.
    it("should not create queue if no type was given", function() {
        const creation = () => EventQueue.create({}, (err, data) => {});
        expect(creation).toThrowError();
    });

    it("should not create queue for an invalid type string", function() {
        const creation = (() =>
            EventQueue.create({type: "novalidtype"}, (err, data) => {})
        );
        expect(creation).toThrowError();
    });


    describe("EventQueueNone", function() {
        beforeEach(function() {
            queue = EventQueue.create({type: "none"}, eventQueueCallback);
        });

        it("should have the proper type", function() {
            expect(queue.type).toEqual("none");
        });

        it("should allow consume on an empty queue", function() {
            queue.consume();
        });

        it("should not show any head of line blocking", function() {
            addedDataCallback = () => {
                // EXPLAINATION
                // Here we check if all 4 (5-1) callbacks finished
                if (callbackData.length != 5) {
                    return;
                }
                // Here we check if the time between the start of the test and
                // the nth finished callback is t timesteps:
                // expect(timeRange(0, n)).toLast(t);
                expect(timeRange(0, 1)).toLast(0);
                expect(timeRange(0, 2)).toLast(0);
                expect(timeRange(0, 3)).toLast(1);
                expect(timeRange(0, 4)).toLast(1);
                done();
            }

            queue.push(eventRoomA, getValueDelayed("A1", 1));
            queue.push(eventRoomA, Promise.resolve("A2"));
            queue.push(eventRoomB, getValueDelayed("B1", 1));
            queue.push(eventRoomB, Promise.resolve("B2"));
            queue.consume();
        });
    });


    describe("EventQueuePerRoom", function() {
        beforeEach(function() {
            queue = EventQueue.create({type: "per_room"}, eventQueueCallback);
        });

        it("should have the proper type", function() {
            expect(queue.type).toEqual("per_room");
        });

        it("should allow consume on an empty queue", function() {
            queue.consume();
        });

        it("should show head of line blocking per room", function(done) {
            addedDataCallback = () => {
                if (callbackData.length != 5) {
                    return;
                }
                expect(timeRange(0, 1)).toLast(1);
                expect(timeRange(0, 2)).toLast(1);
                expect(timeRange(0, 3)).toLast(1);
                expect(timeRange(0, 4)).toLast(1);
                done();
            }

            queue.push(eventRoomA, getValueDelayed("A1", 1));
            queue.push(eventRoomA, Promise.resolve("A2"));
            queue.push(eventRoomB, getValueDelayed("B1", 1));
            queue.push(eventRoomB, Promise.resolve("B2"));
            queue.consume();
        });
    });


    describe("EventQueueSingle", function() {
        beforeEach(function() {
            queue = EventQueue.create({type: "single"}, eventQueueCallback);
        });

        it("should have the proper type", function() {
            expect(queue.type).toEqual("single");
        });

        it("should allow consume on an empty queue", function() {
            queue.consume();
        });

        it("should show head of line blocking", function(done) {
            addedDataCallback = () => {
                if (callbackData.length != 3) {
                    return;
                }
                expect(timeRange(0, 1)).toLast(1);
                expect(timeRange(0, 2)).toLast(1);
                done();
            }

            queue.push(eventRoomA, getValueDelayed("A", 1));
            queue.push(eventRoomB, Promise.resolve("B"));
            queue.consume();
        });
    });
});
