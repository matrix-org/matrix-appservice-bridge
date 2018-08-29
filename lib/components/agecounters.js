"use strict";

const HOUR = 3600;
const DAY = HOUR * 24;
const WEEK = DAY * 7;

const PERIOD_UNITS = {
    "h": HOUR,
    "d": DAY,
    "w": WEEK,
};

const PERIOD_UNIT_KEYS = Object.keys(PERIOD_UNITS);

/**
 * A small helper object that counts into buckets the number of calls to its
 * <code>bump</code> that fall into the given age categories.
 * Counts are maintained within the object, and can be fetched to set
 * into a gauge metric object.
 *
 * This class is useful when exporting metrics that count the number of
 * hourly/daily/weekly active instances of various types of object within the
 * bridge.
 */

class AgeCounters {
    /***
     * @param {String[]} counterPeriods A set of strings denoting the bucket periods
     * used by the gauge. It is in the format of '#X' where # is the integer period and
     * X is the unit of time. A unit can be one of 'h, d, w' for hours, days and weeks.
     * 7d would be 7 days. If not given, the periods are 1h, 1d and 7d.
     */
    constructor(counterPeriods) {
        counterPeriods = counterPeriods || ["1h", "1d", "7d"];
        this.counters = new Map();
        this.counterPeriods = counterPeriods;
        counterPeriods.forEach((periodKey) => {
            if (periodKey.length < 2) {
                throw Error("A period must contain a unit.");
            }
            const unit = periodKey[periodKey.length-1];
            if (!PERIOD_UNIT_KEYS.includes(unit)) {
                throw Error(`The unit period must be one of '${PERIOD_UNIT_KEYS.join(",")}'`);
            }
            const number = parseInt(periodKey.substr(0,periodKey.length-1));
            if (isNaN(number) || number <= 0) {
                throw Error("The period duration must be a positive integer.");
            }
            this.counters.set(number * PERIOD_UNITS[unit], 0);
        });
        this.counterPeriods.push("all");
        this.counters.set("all", 0);
    }

    /**
     * Increment the values of the internal counters depending on the given age,
     * in seconds.
     *
     * @param {Number} age The age in seconds.
     */
    bump(age) {
        this.counters.forEach((value, key) => {
            if (key === "all") {
                this.counters.set("all", value + 1);
            }
            else if (age < key) {
                this.counters.set(key, value + 1);
            }
        });
    };

    /**
     * Fetch the counts in the age buckets and set them as labeled observations in
     * the given gauge metric instance.
     *
     * @param {Gauge} gauge The gauge metric instance.
     * @param {Object} morelabels An object containing more labels to add to the
     * gauge when setting values.
     */
    setGauge(gauge, morelabels) {
        const counters = this.counters;
        let i = 0;
        counters.forEach((value) => {
            const labels = Object.assign(
                {
                    age: this.counterPeriods[i]
                },
                morelabels
            );
            gauge.set(labels, value);
            i++;
        });
    };
}

module.exports = AgeCounters;
