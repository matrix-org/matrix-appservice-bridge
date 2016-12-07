"use strict";

/**
 * Prometheus-style /metrics gathering and exporting.
 * This class provides a central location to register gauge and counter metrics
 * used to generate the <code>/metrics</code> page.
 *
 * This class depends on having <code>prom-client</code> installed. It
 * will attempt to load this module when the constructor is invoked.
 *
 * @example <caption>A simple metric that counts the keys in an object:</caption>
 *   var metrics = new PrometheusMetrics();
 *
 *   var orange = {};
 *   metrics.addGauge({
 *       name: "oranges",
 *       help: "current number of oranges",
 *       refresh: (gauge) => {
 *           gauge.set({}, Object.keys(oranges).length);
 *       },
 *   });
 *
 * @example <caption>Generating values for multiple gauges in a single collector
 * function.</caption>
 *   var metrics = new PrometheusMetrics();
 *
 *   var oranges_gauge = metrics.addGauge({
 *       name: "oranges",
 *       help: "current number of oranges",
 *   });
 *   var apples_gauge = metrics.addGauge({
 *       name: "apples",
 *       help: "current number of apples",
 *   });
 *
 *   metrics.addCollector(() => {
 *       var counts = this._countFruit();
 *       oranges_gauge.set({}, counts.oranges);
 *       apples_gauge.set({}, counts.apples);
 *   });
 *
 * @example <caption>Using counters</caption>
 *   var metrics = new PrometheusMetrics();
 *
 *   metrics.addCollector({
 *       name: "things_made",
 *       help: "count of things that we have made",
 *   });
 *
 *   function makeThing() {
 *       metrics.incCounter("things_made");
 *       return new Thing();
 *   }
 *
 * @constructor
 */
function PrometheusMetrics() {
    // Only attempt to load these dependencies if metrics are enabled
    this._client = require("prom-client");

    this._collectors = []; // executed in order
    this._counters = {}; // counter metrics keyed by name
    this._timers = {}; // timer metrics (Histograms) keyed by name
}

/**
 * Registers some exported metrics that relate to operations of the embedded
 * matrix-js-sdk. In particular, a metric is added that counts the number of
 * calls to client API endpoints made by the client library.
 */
PrometheusMetrics.prototype.registerMatrixSdkMetrics = function() {
    var callCounts = this.addCounter({
        name: "matrix_api_calls",
        help: "Count of the number of Matrix client API calls made",
        labels: ["method"],
    });

    /*
     * We'll now annotate a bunch of the methods in MatrixClient to keep counts
     * of every time they're called. This seems to be neater than trying to
     * intercept all HTTP requests and try to intuit what internal method was
     * invoked based on the HTTP URL.
     * It's kindof messy to do this because we have to maintain a list of
     * client SDK method names, but the only other alternative is to hook the
     * 'request' function and attempt to parse methods out by inspecting the
     * underlying client API HTTP URLs, and that is even messier. So this is
     * the lesser of two evils.
     */

    var matrixClientPrototype = require("matrix-js-sdk").MatrixClient.prototype;

    var CLIENT_METHODS = [
        "ban",
        "createAlias",
        "createRoom",
        "getProfileInfo",
        "getStateEvent",
        "invite",
        "joinRoom",
        "kick",
        "leave",
        "register",
        "roomState",
        "sendEvent",
        "sendReceipt",
        "sendStateEvent",
        "sendTyping",
        "setAvatarUrl",
        "setDisplayName",
        "setPowerLevel",
        "setPresence",
        "setProfileInfo",
        "unban",
        "uploadContent",
    ];

    CLIENT_METHODS.forEach(function(method) {
        callCounts.inc({method: method}, 0); // initialise the count to zero

        var orig = matrixClientPrototype[method];
        matrixClientPrototype[method] = function() {
            callCounts.inc({method: method});
            return orig.apply(this, arguments);
        }
    });
};

/**
 * Registers some exported metrics that expose counts of various kinds of
 * objects within the bridge.
 * @param {BridgeGaugesCallback} counterFunc A function that when invoked
 * returns the current counts of various items in the bridge.
 */
PrometheusMetrics.prototype.registerBridgeGauges = function(counterFunc) {
    var matrixRoomsGauge = this.addGauge({
        name: "matrix_configured_rooms",
        help: "Current count of configured rooms by matrix room ID",
    });
    var remoteRoomsGauge = this.addGauge({
        name: "remote_configured_rooms",
        help: "Current count of configured rooms by remote room ID",
    });

    var matrixGhostsGauge = this.addGauge({
        name: "matrix_ghosts",
        help: "Current count of matrix-side ghost users",
    });
    var remoteGhostsGauge = this.addGauge({
        name: "remote_ghosts",
        help: "Current count of remote-side ghost users",
    });

    var matrixRoomsByAgeGauge = this.addGauge({
        name: "matrix_rooms_by_age",
        help: "Current count of matrix rooms partitioned by activity age",
        labels: ["age"],
    });
    var remoteRoomsByAgeGauge = this.addGauge({
        name: "remote_rooms_by_age",
        help: "Current count of remote rooms partitioned by activity age",
        labels: ["age"],
    });

    var matrixUsersByAgeGauge = this.addGauge({
        name: "matrix_users_by_age",
        help: "Current count of matrix users partitioned by activity age",
        labels: ["age"],
    });
    var remoteUsersByAgeGauge = this.addGauge({
        name: "remote_users_by_age",
        help: "Current count of remote users partitioned by activity age",
        labels: ["age"],
    });

    this.addCollector(function () {
        var counts = counterFunc();

        matrixRoomsGauge.set(counts.matrixRoomConfigs);
        remoteRoomsGauge.set(counts.remoteRoomConfigs);

        matrixGhostsGauge.set(counts.matrixGhosts);
        remoteGhostsGauge.set(counts.remoteGhosts);

        counts.matrixRoomsByAge.setGauge(matrixRoomsByAgeGauge);
        counts.remoteRoomsByAge.setGauge(remoteRoomsByAgeGauge);

        counts.matrixUsersByAge.setGauge(matrixUsersByAgeGauge);
        counts.remoteUsersByAge.setGauge(remoteUsersByAgeGauge);
    });
};

PrometheusMetrics.prototype.refresh = function() {
    this._collectors.forEach(function(f) { f(); });
};

/**
 * Adds a new collector function. These collector functions are run whenever
 * the /metrics page is about to be generated, allowing code to update values
 * of gauges.
 * @param {Function} func A new collector function.
 * This function is passed no arguments and is not expected to return anything.
 * It runs purely to have a side-effect on previously registered gauges.
 */
PrometheusMetrics.prototype.addCollector = function(func) {
    this._collectors.push(func);
};

/**
 * Adds a new gauge metric.
 * @param {Object} opts Options
 * @param {string=} opts.namespace An optional toplevel namespace name for the
 * new metric. Default: <code>"bridge"</code>.
 * @param {string} opts.name The variable name for the new metric.
 * @param {string} opts.help Descriptive help text for the new metric.
 * @param {Array<string>=} opts.labels An optional list of string label names
 * @param {Function=} opts.refresh An optional function to invoke to generate a
 * new value for the gauge.
 * If a refresh function is provided, it is invoked with the gauge as its only
 * parameter. The function should call the <code>set()</code> method on this
 * gauge in order to provide a new value for it.
 * @return {Gauge} A gauge metric.
 */
PrometheusMetrics.prototype.addGauge = function(opts) {
    var refresh = opts.refresh;
    var name = [opts.namespace || "bridge", opts.name].join("_");

    var gauge = new this._client.Gauge(name, opts.help, opts.labels || []);

    if (opts.refresh) {
        this._collectors.push(function() { refresh(gauge); });
    }

    return gauge;
};

/**
 * Adds a new counter metric
 * @param {Object} opts Options
 * @param {string} opts.namespace An optional toplevel namespace name for the
 * new metric. Default: <code>"bridge"</code>.
 * @param {string} opts.name The variable name for the new metric.
 * @param {string} opts.help Descriptive help text for the new metric.
 * Once created, the value of this metric can be incremented with the
 * <code>incCounter</code> method.
 * @param {Array<string>=} opts.labels An optional list of string label names
 * @return {Counter} A counter metric.
 */
PrometheusMetrics.prototype.addCounter = function(opts) {
    var name = [opts.namespace || "bridge", opts.name].join("_");

    var counter = this._counters[opts.name] =
        new this._client.Counter(name, opts.help, opts.labels || []);

    return counter;
};

/**
 * Increments the value of a counter metric
 * @param{string} name The name the metric was previously registered as.
 * @param{Object} labels Optional object containing additional label values.
 */
PrometheusMetrics.prototype.incCounter = function(name, labels) {
    if (!this._counters[name]) {
        throw new Error("Unrecognised counter metric name '" + name + "'");
    }

    this._counters[name].inc(labels);
};

/**
 * Adds a new timer metric, represented by a prometheus Histogram.
 * @param {Object} opts Options
 * @param {string} opts.namespace An optional toplevel namespace name for the
 * new metric. Default: <code>"bridge"</code>.
 * @param {string} opts.name The variable name for the new metric.
 * @param {string} opts.help Descriptive help text for the new metric.
 * @param {Array<string>=} opts.labels An optional list of string label names
 * @return {Histogram} A histogram metric.
 * Once created, the value of this metric can be incremented with the
 * <code>startTimer</code> method.
 */
PrometheusMetrics.prototype.addTimer = function(opts) {
    var name = [opts.namespace || "bridge", opts.name].join("_");

    var timer = this._timers[opts.name] =
        new this._client.Histogram(name, opts.help, opts.labels || []);

    return timer;
};

/**
 * Begins a new timer observation for a timer metric.
 * @param{string} name The name the metric was previously registered as.
 * @param{Object} labels Optional object containing additional label values.
 * @return {function} A function to be called to end the timer and report the
 * observation.
 */
PrometheusMetrics.prototype.startTimer = function(name, labels) {
    if (!this._timers[name]) {
        throw new Error("Unrecognised timer metric name '" + name + "'");
    }

    return this._timers[name].startTimer(labels);
};

/**
 * Registers the <code>/metrics</code> page generating function with the
 * containing Express app.
 * @param {Bridge} bridge The containing Bridge instance.
 */
PrometheusMetrics.prototype.addAppServicePath = function(bridge) {
    var register = this._client.register;

    bridge.addAppServicePath({
        method: "GET",
        path: "/metrics",
        handler: function(req, res) {
            this.refresh();

            try {
                var exposition = register.metrics();

                res.set("Content-Type", "text/plain");
                res.send(exposition);
            }
            catch (e) {
                res.status(500);

                res.set("Content-Type", "text/plain");
                res.send(e.toString());
            }
        }.bind(this),
    });
};

/**
 * Invoked at metrics export time to count items in the bridge.
 * @callback BridgeGaugesCallback
 * @return {BridgeGaugesCounts} An object containing counts of items in the
 * bridge.
 */

/**
 * @typedef BridgeGaugesCounts
 * @type {Object}
 * @param {number} matrixRoomConfigs The number of distinct matrix room IDs
 * known in the configuration.
 * @param {number} remoteRoomConfigs The number of distinct remote rooms known
 * in the configuration.
 * @param {number} matrixGhosts The number of matrix-side ghost users that
 * currently exist.
 * @param {number} remoteGhosts The number of remote-side ghost users that
 * currently exist.
 * @param {AgeCounters} matrixRoomsByAge The distribution of distinct matrix
 * room IDs by age of the most recently-seen message from them,
 * @param {AgeCounters} remoteRoomsByAge The distribution of distinct remote
 * rooms by age of the most recently-seen message from them.
 * @param {AgeCounters} matrixUsersByAge The distribution of distinct matrix
 * users by age of the most recently-seen message from them.
 * @param {AgeCounters} remoteUsersByAge The distribution of distinct remote
 * users by age of the most recently-seen message from them.
 */

module.exports = PrometheusMetrics;
