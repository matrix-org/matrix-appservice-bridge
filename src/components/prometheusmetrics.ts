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

import PromClient, { Registry } from "prom-client";
import { AgeCounters } from "./agecounters";
import JsSdk from "matrix-js-sdk";
import { Request, Response } from "express";
type CollectorFunction = () => void;

export interface BridgeGaugesCounts {
    matrixRoomConfigs?: number;
    remoteRoomConfigs?: number;
    matrixGhosts?: number;
    remoteGhosts?: number;
    matrixRoomsByAge?: AgeCounters;
    remoteRoomsByAge?: AgeCounters;
    matrixUsersByAge?: AgeCounters;
    remoteUsersByAge?: AgeCounters;
}

interface CounterOpts {
    namespace?: string;
    name: string;
    help: string;
    labels?: string[];
}

interface GagueOpts {
    namespace?: string;
    name: string;
    help: string;
    labels?: string[];
    refresh?: (gauge: PromClient.Gauge<string>) => void;
}

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
export class PrometheusMetrics {
    public static AgeCounters = AgeCounters;
    private timers: {[name: string]: PromClient.Histogram<string>} = {};
    private counters: {[name: string]: PromClient.Counter<string>} = {};
    private collectors: CollectorFunction[] = [];
    private register: Registry;
    constructor(register?: Registry) {
        this.register = register || PromClient.register;
        PromClient.collectDefaultMetrics({ register: this.register });
    }

    /**
    * Registers some exported metrics that relate to operations of the embedded
    * matrix-js-sdk. In particular, a metric is added that counts the number of
    * calls to client API endpoints made by the client library.
    */
    public registerMatrixSdkMetrics() {
        const callCounts = this.addCounter({
            name: "matrix_api_calls",
            help: "Count of the number of Matrix client API calls made",
            labels: ["method"],
        });

        /*
            * We'll now annotate a bunch of the methods in MatrixClient to keep counts
            * of every time they're called. This seems to be neater than trying to
            * intercept all HTTP requests and try to intuit what internal method was
            * invoked based on the HTTP URL.
            * It's kind of messy to do this because we have to maintain a list of
            * client SDK method names, but the only other alternative is to hook the
            * 'request' function and attempt to parse methods out by inspecting the
            * underlying client API HTTP URLs, and that is even messier. So this is
            * the lesser of two evils.
            */
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const matrixClientPrototype = (JsSdk as any).MatrixClient.prototype;

        const CLIENT_METHODS = [
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

            const orig = matrixClientPrototype[method];
            matrixClientPrototype[method] = function(...args: unknown[]) {
                callCounts.inc({method: method});
                return orig.apply(this, args);
            }
        });
    }

    /**
     * Registers some exported metrics that expose counts of various kinds of
     * objects within the bridge.
     * @param {BridgeGaugesCallback} counterFunc A function that when invoked
     * returns the current counts of various items in the bridge.
     */
    public registerBridgeGauges (counterFunc: () => BridgeGaugesCounts) {
        const matrixRoomsGauge = this.addGauge({
            name: "matrix_configured_rooms",
            help: "Current count of configured rooms by matrix room ID",
        });
        const remoteRoomsGauge = this.addGauge({
            name: "remote_configured_rooms",
            help: "Current count of configured rooms by remote room ID",
        });

        const matrixGhostsGauge = this.addGauge({
            name: "matrix_ghosts",
            help: "Current count of matrix-side ghost users",
        });
        const remoteGhostsGauge = this.addGauge({
            name: "remote_ghosts",
            help: "Current count of remote-side ghost users",
        });

        const matrixRoomsByAgeGauge = this.addGauge({
            name: "matrix_rooms_by_age",
            help: "Current count of matrix rooms partitioned by activity age",
            labels: ["age"],
        });
        const remoteRoomsByAgeGauge = this.addGauge({
            name: "remote_rooms_by_age",
            help: "Current count of remote rooms partitioned by activity age",
            labels: ["age"],
        });

        const matrixUsersByAgeGauge = this.addGauge({
            name: "matrix_users_by_age",
            help: "Current count of matrix users partitioned by activity age",
            labels: ["age"],
        });
        const remoteUsersByAgeGauge = this.addGauge({
            name: "remote_users_by_age",
            help: "Current count of remote users partitioned by activity age",
            labels: ["age"],
        });

        this.addCollector(function () {
            const counts = counterFunc();

            if (counts.matrixRoomConfigs) {matrixRoomsGauge.set(counts.matrixRoomConfigs);}

            if (counts.remoteRoomConfigs) {remoteRoomsGauge.set(counts.remoteRoomConfigs);}

            if (counts.matrixGhosts) {matrixGhostsGauge.set(counts.matrixGhosts);}

            if (counts.remoteGhosts) {remoteGhostsGauge.set(counts.remoteGhosts);}

            counts.matrixRoomsByAge?.setGauge(matrixRoomsByAgeGauge);
            counts.remoteRoomsByAge?.setGauge(remoteRoomsByAgeGauge);

            counts.matrixUsersByAge?.setGauge(matrixUsersByAgeGauge);
            counts.remoteUsersByAge?.setGauge(remoteUsersByAgeGauge);
        });
    }

    public refresh () {
        this.collectors.forEach((f) => f());
    }

    /**
     * Adds a new collector function. These collector functions are run whenever
     * the /metrics page is about to be generated, allowing code to update values
     * of gauges.
     * @param {Function} func A new collector function.
     * This function is passed no arguments and is not expected to return anything.
     * It runs purely to have a side-effect on previously registered gauges.
     */
    public addCollector (func: CollectorFunction) {
        this.collectors.push(func);
    }

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
    public addGauge (opts: GagueOpts) {
        const refresh = opts.refresh;
        const name = [opts.namespace || "bridge", opts.name].join("_");

        const gauge = new PromClient.Gauge({
            labelNames: opts.labels || [],
            help: opts.help,
            name: name,
            registers: [this.register]
        });

        if (refresh) {
            this.collectors.push(() => refresh(gauge));
        }

        return gauge;
    }

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
    public addCounter (opts: CounterOpts) {
        const name = [opts.namespace || "bridge", opts.name].join("_");

        const counter = this.counters[opts.name] =
            new PromClient.Counter({
                name,
                help: opts.help,
                labelNames: opts.labels || [],
                registers: [this.register]
            });

        return counter;
    }

    /**
     * Increments the value of a counter metric
     * @param{string} name The name the metric was previously registered as.
     * @param{Object} labels Optional object containing additional label values.
     */
    public incCounter (name: string, labels: {[label: string]: string}) {
        if (!this.counters[name]) {
            throw new Error("Unrecognised counter metric name '" + name + "'");
        }

        this.counters[name].inc(labels);
    }

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
    public addTimer(opts: CounterOpts) {
        const name = [opts.namespace || "bridge", opts.name].join("_");

        const timer = this.timers[opts.name] =
            new PromClient.Histogram({
                name,
                help: opts.help,
                labelNames: opts.labels || [],
                registers: [this.register]
            });

        return timer;
    }

    /**
     * Begins a new timer observation for a timer metric.
     * @param{string} name The name the metric was previously registered as.
     * @param{Object} labels Optional object containing additional label values.
     * @return {function} A function to be called to end the timer and report the
     * observation.
     */
    public startTimer(name: string, labels: {[label: string]: string}) {
        if (!this.timers[name]) {
            throw Error("Unrecognised timer metric name '" + name + "'");
        }

        return this.timers[name].startTimer(labels);
    }

    /**
     * Registers the <code>/metrics</code> page generating function with the
     * containing Express app.
     * @param {Bridge} bridge The containing Bridge instance.
     */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public addAppServicePath(bridge: any) {
        bridge.addAppServicePath({
            method: "GET",
            path: "/metrics",
            // TODO: Ideally these metrics would be on a different port.
            // For now, leave this unauthenticated.
            checkToken: false,
            handler: (_req: Request, res: Response) => {
                this.refresh();

                try {
                    const exposition = this.register.metrics();

                    res.set("Content-Type", "text/plain");
                    res.send(exposition);
                }
                catch (e) {
                    res.status(500);

                    res.set("Content-Type", "text/plain");
                    res.send(e.toString());
                }
            },
        });
    }
}
