"use strict";

var HOUR = 3600;
var DAY  = HOUR * 24;

function AgeCounters() {
    this["1h"] = 0;
    this["1d"] = 0;
    this["7d"] = 0;
    this["all"] = 0;
}

AgeCounters.prototype.bump = function(age) {
    if (age < HOUR   ) this["1h"]++;
    if (age < DAY    ) this["1d"]++;
    if (age < DAY * 7) this["7d"]++;

    this["all"]++;
};

AgeCounters.prototype.setGauge = function(gauge, morelabels) {
    Object.keys(this).forEach((age) => {
        // I wish I could use spread expressions
        var labels = {age: age};
        Object.keys(morelabels).forEach((k) => labels[k] = morelabels[k]);

        gauge.set(labels, this[age]);
    });
};

module.exports = AgeCounters;
