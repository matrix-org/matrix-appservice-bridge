const AgeCounters = require("../../lib/components/agecounters");

describe("AgeCounters", function() {
    describe("constructor", function() {
        it("Can construct some counter periods by default", function() {
            const ageCounter = new AgeCounters();
            expect(ageCounter.counterPeriods).toEqual(["1h", "1d", "7d", "all"]);
            expect(ageCounter.counters.size).toEqual(4);
            const mapIter = ageCounter.counters.keys();
            expect(mapIter.next().value).toEqual(3600);
            expect(mapIter.next().value).toEqual(3600 * 24);
            expect(mapIter.next().value).toEqual(3600 * 24 * 7);
            expect(mapIter.next().value).toEqual("all");
        });

        it("Can construct given counter periods", function() {
            const ageCounter = new AgeCounters(["1h", "2d", "5d", "3w"]);
            expect(ageCounter.counterPeriods).toEqual(["1h", "2d", "5d", "3w", "all"]);
            expect(ageCounter.counters.size).toEqual(5);
            const mapIter = ageCounter.counters.keys();
            expect(mapIter.next().value).toEqual(3600);
            expect(mapIter.next().value).toEqual(3600 * 24 * 2);
            expect(mapIter.next().value).toEqual(3600 * 24 * 5);
            expect(mapIter.next().value).toEqual(3600 * 24 * 7 * 3);
            expect(mapIter.next().value).toEqual("all");
        });

        it("Can construct with an empty array", function() {
            const ageCounter = new AgeCounters([]);
            expect(ageCounter.counterPeriods).toEqual(["all"]);
            expect(ageCounter.counters.size).toEqual(1);
        });

        it("Cannot construct with invalid period strings", function() {
            expect(() => {new AgeCounters(["cats", "dogs"]);}).toThrow();
            expect(() => {new AgeCounters(["5"]);}).toThrow();
            expect(() => {new AgeCounters(["h"]);}).toThrow();
            expect(() => {new AgeCounters(["1x"]);}).toThrow();
        });
        it("Cannot construct with negative integers", function() {
            expect(() => {new AgeCounters(["-1h"]);}).toThrow();
        });

        it("Cannot construct counter with null", function() {
            expect(() => {new AgeCounters([null]);}).toThrow();
            expect(() => {new AgeCounters([undefined]);}).toThrow();
        });
    });

    describe("bump", function () {
        it("Bumping a small age should go in all slots", function() {
            const ageCounter = new AgeCounters(["1h", "2d", "5d"]);
            ageCounter.bump(1200);
            expect(ageCounter.counters.get(3600)).toEqual(1);
            expect(ageCounter.counters.get(3600 * 24 * 2)).toEqual(1);
            expect(ageCounter.counters.get(3600 * 24 * 5)).toEqual(1);
            expect(ageCounter.counters.get("all")).toEqual(1);
        });

        it("Bumping a middling age should only go in some", function() {
            const ageCounter = new AgeCounters(["1h", "2d", "5d"]);
            ageCounter.bump(3600 * 24 * 2);
            expect(ageCounter.counters.get(3600)).toEqual(0);
            expect(ageCounter.counters.get(3600 * 24 * 2)).toEqual(0);
            expect(ageCounter.counters.get(3600 * 24 * 5)).toEqual(1);
            expect(ageCounter.counters.get("all")).toEqual(1);
        });

        it("Bumping a large age should only go in 'all'", function() {
            const ageCounter = new AgeCounters(["1h", "2d", "5d"]);
            ageCounter.bump(1200000);
            expect(ageCounter.counters.get(3600)).toEqual(0);
            expect(ageCounter.counters.get(3600 * 24 * 2)).toEqual(0);
            expect(ageCounter.counters.get(3600 * 24 * 5)).toEqual(0);
            expect(ageCounter.counters.get("all")).toEqual(1);
        });
    })
    describe("setGauge", function () {
        it("Should appropriately report gauge contents", function() {
            const ageCounter = new AgeCounters(["1h", "2d", "5d"]);
            for (let i = 0; i < 5;i++){
                ageCounter.bump(1200);
            }

            for (let i = 0; i < 3;i++){
                ageCounter.bump(3600 * 24);
            }

            for (let i = 0; i < 7;i++){
                ageCounter.bump(3600 * 24 * 7);
            }
            const gaugeContents = [];
            const mockGauge = {
                set: (labels, count) => {
                    gaugeContents.push({labels, count});
                }
            };
            ageCounter.setGauge(mockGauge, {aLabel: 42});
            expect(gaugeContents[0]).toEqual({
                labels: {
                    age: "1h",
                    aLabel: 42,
                },
                count: 5
            });
            expect(gaugeContents[1]).toEqual({
                labels: {
                    age: "2d",
                    aLabel: 42,
                },
                count: 8
            });
            expect(gaugeContents[2]).toEqual({
                labels: {
                    age: "5d",
                    aLabel: 42,
                },
                count: 8
            });
            expect(gaugeContents[3]).toEqual({
                labels: {
                    age: "all",
                    aLabel: 42,
                },
                count: 15
            });
        });
    });

});
