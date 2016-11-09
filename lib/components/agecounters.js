"use strict";

var HOUR = 3600;
var DAY = HOUR * 24;
var WEEK = DAY * 7;

/**
 * A small helper object that counts into buckets the number of calls to its
 * <code>bump</code> that fall into three age categories; ages within an hour,
 * within a day or within seven days. Counts are maintained within the object,
 * and can be fetched to set into a gauge metric object.
 *
 * This class is useful when exporting metrics that count the number of
 * hourly/daily/weekly active instances of various types of object within the
 * bridge.
 *
 * @constructor
 */
function AgeCounters() {
    this.counters = {
        "1h": 0,
        "1d": 0,
        "7d": 0,
        all: 0,
    };
}

/**
 * Increment the values of the internal counters depending on the given age,
 * in seconds.
 *
 * @param {Number} age The age in seconds.
 */
AgeCounters.prototype.bump = function(age) {
    if (age < HOUR) {
        this.counters["1h"]++;
    }
    if (age < DAY ) {
        this.counters["1d"]++;
    }
    if (age < WEEK) {
        this.counters["7d"]++;
    }

    this.counters["all"]++;
};

/**
 * Fetch the counts in the age buckets and set them as labeled observations in
 * the given gauge metric instance.
 *
 * @param {Gauge} gauge The gauge metric instance.
 * @param {Object} morelabels An object containing more labels to add to the
 * gauge when setting values.
 */
AgeCounters.prototype.setGauge = function(gauge, morelabels) {
    var counters = this.counters;

    Object.keys(counters).forEach(function(age) {
        var labels = Object.assign({age: age}, morelabels);
        gauge.set(labels, counters[age]);
    });
};

module.exports = AgeCounters;
