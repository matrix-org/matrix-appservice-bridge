"use strict";

var fs = require("fs");

var TICKS_PER_SEC = 100; // TODO(paul): look this up via sysconf(_SC_CLK_TCK)

/**
 * Prometheus-style /metrics gathering and exporting.
 * This class provides a central location to register gauge and counter metrics
 * used to generate the <code>/metrics</code> page. It also contains collector
 * code to generate the standard <code>process_</code> and <code>nodejs_</code>
 * metrics:
 *   process_resident_memory_bytes
 *   process_virtual_memory_bytes
 *   process_heap_bytes
 *   process_cpu_seconds_total
 *   process_open_fds
 *   process_max_fds
 *   process_start_time_seconds
 *   nodejs_heap_used_bytes
 *
 * @example <caption>A simple metric that counts the keys in an object:</caption>
 *   var metrics = new Metrics();
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
 * @example <caption>Generating values for multiple gauges in a single collector function.</caption>
 *   var metrics = new Metrics();
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
 *   var metrics = new Metrics();
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
function Metrics() {
    // Only attempt to load these dependencies if metrics are enabled
    var Prometheus = require("prometheus-client");

    var client = this._client = new Prometheus();

    this._collectors = []; // executed in order
    this._counters = {}; // counter metrics keyed by name

    // Register some built-in process-wide metrics
    // See also
    //   https://prometheus.io/docs/instrumenting/writing_clientlibs/#standard-and-runtime-collectors

    var rss_gauge = this.addGauge({
        namespace: "process",
        name: "resident_memory_bytes",
        help: "Resident memory size in bytes",
    });
    var vsz_gauge = this.addGauge({
        namespace: "process",
        name: "virtual_memory_bytes",
        help: "Virtual memory size in bytes",
    });

    var heap_size_gauge = this.addGauge({
        namespace: "process",
        name: "heap_bytes",
        help: "Total size of Node.js heap in bytes",
    });
    var heap_used_gauge = this.addGauge({
        namespace: "nodejs",
        name: "heap_used_bytes",
        help: "Used size of Node.js heap in bytes",
    });

    var cpu_gauge = this.addGauge({
        namespace: "process",
        name: "cpu_seconds_total",
        help: "Total user and system CPU time spent in seconds",
    });

    var cpu_user_gauge = this.addGauge({
        namespace: "process",
        name: "cpu_user_seconds_total",
        help: "Total user CPU time spent in seconds",
    });
    var cpu_system_gauge = this.addGauge({
        namespace: "process",
        name: "cpu_system_seconds_total",
        help: "Total system CPU time spent in seconds",
    });

    this.addCollector(function() {
        var usage = process.memoryUsage();

        rss_gauge.set({}, usage.rss);
        heap_size_gauge.set({}, usage.heapTotal);
        heap_used_gauge.set({}, usage.heapUsed);

        var stats = _read_proc_self_stat();

        // CPU times in ticks
        var utime_secs = stats[11] / TICKS_PER_SEC;
        var stime_secs = stats[12] / TICKS_PER_SEC;

        cpu_gauge.set({}, utime_secs + stime_secs);
        cpu_user_gauge.set({}, utime_secs);
        cpu_system_gauge.set({}, stime_secs);

        // Virtual memory size
        vsz_gauge.set({}, stats[20]);
    });

    this.addGauge({
        namespace: "process",
        name: "open_fds",
        help: "Number of open file descriptors",
        refresh: function(gauge) {
            var fds = fs.readdirSync("/proc/self/fd");

            // subtract 1 due to readdir handle itself
            gauge.set(null, fds.length - 1);
        }
    });

    this.addGauge({
        namespace: "process",
        name: "max_fds",
        help: "Maximum number of open file descriptors allowed",
        refresh: function(gauge) {
            var limits = fs.readFileSync("/proc/self/limits");
            limits.toString().split(/\n/).forEach(function(line) {
                if (!line.match(/^Max open files /)) return;

                // "Max", "open", "files", $SOFT, $HARD, "files"
                gauge.set({}, line.split(/\s+/)[3]);
            });
        }
    });

    // This value will be constant for the lifetime of the process
    this.addGauge({
        namespace: "process",
        name: "start_time_seconds",
        help: "Start time of the process since unix epoch in seconds",
    }).set({}, _calculate_process_start_time());

    this.refresh();
};

function _read_proc_self_stat() {
    var stat_line = fs.readFileSync("/proc/self/stat")
        .toString().split(/\n/)[0];
    // Line contains PID (exec_name) bunch of stats here...
    return stat_line.match(/\) +(.*)$/)[1].split(" ");
}

function _calculate_process_start_time() {
    // The 'starttime' field in /proc/self/stat gives the number of CPU ticks
    //   since machine boot time that this process started.
    var stats = _read_proc_self_stat();
    var starttime_sec = stats[19] / TICKS_PER_SEC;

    var btime_line = fs.readFileSync("/proc/stat")
        .toString().split(/\n/).filter(function(l) { return l.match(/^btime /); })[0];
    var btime = Number(btime_line.split(" ")[1]);

    return btime + starttime_sec;
}

Metrics.prototype.refresh = function() {
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
Metrics.prototype.addCollector = function(func) {
    this._collectors.push(func);
};

/**
 * Adds a new gauge metric.
 * @param {Object} opts Options
 * @param {string=} opts.namespace An optional toplevel namespace name for the
 * new metric. Default: <code>"bridge"</code>.
 * @param {string} opts.name The variable name for the new metric.
 * @param {string} opts.help Descriptive help text for the new metric.
 * @param {Function=} opts.refresh An optional function to invoke to generate a
 * new value for the gauge.
 * If a refresh function is provided, it is invoked with the gauge as its only
 * parameter. The function should call the <code>set()</code> method on this
 * gauge in order to provide a new value for it.
 * @return {Gauge} A gauge metric.
 */
Metrics.prototype.addGauge = function(opts) {
    var refresh = opts.refresh;
    var gauge = this._client.newGauge({
        namespace: opts.namespace || "bridge",
        name: opts.name,
        help: opts.help,
    });

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
 */
Metrics.prototype.addCounter = function(opts) {
    this._counters[opts.name] = this._client.newCounter({
        namespace: opts.namespace || "bridge",
        name: opts.name,
        help: opts.help,
    });
};

/**
 * Increments the value of a counter metric
 * @param{string} name The name the metric was previously registered as.
 * @param{Object} labels Optional object containing additional label values.
 */
Metrics.prototype.incCounter = function(name, labels) {
    if (!this._counters[name]) {
        throw new Error("Unrecognised counter metric name '" + name + "'");
    }

    this._counters[name].increment(labels);
};

/**
 * Registers the <code>/metrics</code> page generating function with the
 * containing Express app.
 * @param {Bridge} bridge The containing Bridge instance.
 */
Metrics.prototype.addAppServicePath = function(bridge) {
    var metricsFunc = this._client.metricsFunc();

    bridge.addAppServicePath({
        method: "GET",
        path: "/metrics",
        handler: function(req, res) {
            this.refresh();
            return metricsFunc(req, res);
        }.bind(this),
    });
};

module.exports = Metrics;
