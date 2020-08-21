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
import * as util from "util";
import winston, { Logger, format, Logform } from "winston";
import "winston-daily-rotate-file";
import * as chalk from "chalk";
import * as Transport from 'winston-transport';
import { DailyRotateFile } from "winston/lib/winston/transports";

type LogLevel = "debug"|"info"|"warn"|"error";

const CHALK_LEVELS: Record<LogLevel, string> = {
    "debug": "blue",
    "info": "green",
    "warn": "yellow",
    "error": "red",
}

type MessagePart = unknown;
interface LoggerConfig {
    console?: "error"|"warn"|"info"|"debug"|"off",
    fileDatePattern?: string,
    timestampFormat?: string,
    files?: {
        [filename: string]: "error"|"warn"|"info"|"debug"|"off",
    }
    maxFiles?: number,
}

export class LogWrapper {
    private logger: Logger|null = null;
    private messages: {type: LogLevel, message: string}[] = [];

    public setLogger(logger: Logger) {
        this.logger = logger;
    }

    public debug(...messageParts: MessagePart[]) { this.log(messageParts, 'debug') }

    public info(...messageParts: MessagePart[]) { this.log(messageParts, 'info') }

    public warn(...messageParts: MessagePart[]) { this.log(messageParts, 'warn') }

    public error(...messageParts: MessagePart[]) { this.log(messageParts, 'error') }

    public drain() {
        if (!this.logger) { return; }
        while (this.messages.length > 0) {
            const msg = this.messages[0];
            this.logger[msg.type](msg.message);
            this.messages.splice(0, 1);
        }
    }

    private formatParts(messageParts: MessagePart[]): string[] {
        return messageParts.map((part) => {
            if (typeof(part) === "object") {
                return util.inspect(part);
            }
            return String(part);
        });
    }

    private log(messageParts: MessagePart[], type: LogLevel) {
        const formattedParts = this.formatParts(messageParts).join(" ");
        if (this.logger === null) {
            this.messages.push({type, message: formattedParts});
            return;
        }
        /* When we first start logging, the transports
         * won't be configured so we push to a queue.
         * When the transport becomes ready, the queue
         * is emptied. */
        this.drain();
        this.logger[type](formattedParts);
    }
}

class Logging {
    private loggers: Map<string, LogWrapper> = new Map();
    private formatterFn: Logform.Format;
    private colorFn: Logform.FormatWrap;
    private transports: Transport[];
    private config: LoggerConfig|null = null;
    constructor() {
        this.transports = [];

        this.formatterFn = format.printf((info) => {
            return `${info.timestamp} ${info.level} ${info.label} ${info.message}`;
        });

        this.colorFn = format((info) => {
            const level = info.level.toUpperCase() as LogLevel;
            const levelColour = CHALK_LEVELS[info.level as LogLevel];
            if (levelColour) {
                info.level = chalk.keyword(levelColour)(level);
            }
            return info;
        })
    }

    /*
        console: "error|warn|info|debug|off"
        fileDatePattern: "YYYY-MM-DD",
        timestampFormat: "MMM-D HH:mm:ss.SSS"
        files: {
            "abc.log" => "error|warn|info|debug|off"
        }
        maxFiles: 5
    */
    configure(config: LoggerConfig) {
        if (!config.fileDatePattern) {
            config.fileDatePattern = "YYYY-MM-DD";
        }
        if (!config.timestampFormat) {
            config.timestampFormat = "MMM-D HH:mm:ss.SSS";
        }
        if (!config.console) {
            config.console = "info";
        }
        if (!config.maxFiles) {
            config.maxFiles = 0;
        }
        this.config = config;

        if (this.transports) {
            for (const transport of this.transports) {
                if (transport.close) {
                    transport.close();
                }
            }
        }

        this.transports = [];
        if (config.console !== undefined && config.console !== "off") {
            this.transports.push(new (winston.transports.Console)({
                level: config.console,
                format: format.combine(
                    this.colorFn(),
                    this.formatterFn
                )
            }));
        }

        if (config.files !== undefined) {
            for (const filename of Object.keys(config.files)) {
                const level = config.files[filename];
                this.transports.push(new DailyRotateFile({
                    filename,
                    datePattern: config.fileDatePattern,
                    level,
                    maxFiles: config.maxFiles > 0 ? config.maxFiles : undefined
                }));
            }
        }

        this.loggers.forEach((wrapper, name) => {
            wrapper.setLogger(this.createLogger(name));
            wrapper.drain();
        });
    }

    public get(name: string) {
        const existingLogger = this.loggers.get(name);
        if (existingLogger) {
            return existingLogger;
        }
        const wrapper = new LogWrapper()
        this.loggers.set(name, wrapper);
        /* We won't assign create and assign a logger until
            * the transports are ready */
        if (this.transports !== null) {
            wrapper.setLogger(this.createLogger(name));
        }
        return wrapper;
    }

    public createLogger(name: string) {
        const logger = winston.createLogger({
            transports: this.transports,
            format: format.combine(
                format.timestamp({
                    format: this.config?.timestampFormat,
                }),
                format.label({label: name}),
                this.formatterFn
            ),
        });
        return logger;
    }
}

const instance: Logging = new Logging();
let isConfigured = false;

export function get(name: string) {
    return instance.get(name);
}

export function configure (config: LoggerConfig) {
    instance.configure(config);
    isConfigured = true;
}

export function configured() {
    return isConfigured;
}

// Backwards compat
export default {
    get,
    configure,
    configured,
}
