/*
Copyright 2022 The Matrix.org Foundation C.I.C.

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
/* eslint-disable @typescript-eslint/no-explicit-any */
import { ILogger, LogLevel as BotSdkLogLevel, LogService } from "matrix-bot-sdk";
import util from "util";
import winston, { format } from "winston";

/**
 * Acceptable values for a log line entry.
 */
type LogEntryPart = string|Error|any|{error?: string};

/**
 * Tries to filter out noise from the bot-sdk.
 * @param LogEntryPart A list of values being logged.
 * @returns True is the message is noise, or false otherwise.
 */
function isMessageNoise(LogEntryPart: LogEntryPart[]) {
    return LogEntryPart.some(messageOrObject => {
        if (typeof messageOrObject !== "object") {
            return false;
        }

        const possibleError = messageOrObject as {
            error?: string, body?: { error?: string, errcode?: string}, errcode?: string
        }

        const error = possibleError?.error || possibleError?.body?.error;
        const errcode = possibleError?.errcode || possibleError?.body?.errcode;

        if (errcode === "M_NOT_FOUND" && error === "Room account data not found") {
            return true;
        }

        if (errcode === "M_NOT_FOUND" && error === "Event not found.") {
            return true;
        }

        if (errcode === "M_USER_IN_USE") {
            return true;
        }

        return false;
    });
}

interface LogEntry extends winston.Logform.TransformableInfo {
    data: LogEntryPart[];
    requestId: string;
    module: string;
}


export interface CustomLogger {
    verbose: (message: string, ...metadata: any[]) => void,
    debug: (message: string, ...metadata: any[]) => void,
    info: (message: string, ...metadata: any[]) => void,
    warn: (message: string, ...metadata: any[]) => void,
    error: (message: string, ...metadata: any[]) => void,
}

export type LogLevel = "debug"|"info"|"warn"|"error"|"trace";

export interface LoggingOpts {
    /**
     * The log level used by the console output.
     */
    console?: "debug"|"info"|"warn"|"error"|"trace"|"off";
    /**
     * Should the logs be outputted in JSON format, for consumption by a collector.
     */
    json?: boolean;
    /**
     * Should the logs color-code the level strings in the output.
     */
    colorize?: boolean;
    /**
     * Timestamp format used in the log output.
     * @default "HH:mm:ss:SSS"
     */
    timestampFormat?: string;
}

export interface LoggingOptsFile extends LoggingOpts {
    /**
     * An object mapping a file name to a logging level. The file will contain
     * all logs for that level inclusive up to the highest level. (`info` will contain `warn`, `error` etc)
     * Use `%DATE%` to set the date of the file within the string.
     * Use the `fileDatePattern` to set the date format.
     * @example {"info-%DATE%.log": "info"}
     */
    files: {
        [filename: string]: LogLevel,
    }
    /**
     * The number of files to keep before the last file is rotated.
     * If not set, no files are deleted.
     */
    maxFiles?: number,
    /**
     * The moment.js compatible date string to use when naming files.
     */
    fileDatePattern?: string,
}

export interface CustomLoggingOpts {
    /**
     * An object which implements the required functions for log output.
     */
    logger: CustomLogger;
}

export class GlobalLogger {
    private isConfigured = false;

    public get configured() {
        return this.isConfigured;
    }

    private winstonLog?: winston.Logger;

    public get winston() {
        return this.winstonLog;
    }

    public configureLogging(cfg: LoggingOpts|LoggingOptsFile, debugStream?: NodeJS.WritableStream) {
        this.winstonLog?.close();

        const formatters = [
            winston.format.timestamp({
                format: cfg.timestampFormat || "HH:mm:ss:SSS",
            }),
            (format((info) => {
                info.level = info.level.toUpperCase();
                return info;
            }))(),
        ]

        if (!cfg.json && cfg.colorize) {
            formatters.push(
                winston.format.colorize({
                    level: true,
                })
            );
        }

        if (cfg.json) {
            const formatter = format((info) => {
                const logEntry = info as LogEntry;
                const hsData = [...logEntry.data];
                const firstArg = hsData.shift() ?? 'undefined';
                const result: winston.Logform.TransformableInfo = {
                    level: logEntry.level,
                    module: logEntry.module,
                    timestamp: logEntry.timestamp,
                    requestId: logEntry.requestId,
                    // Find the first instance of an error, subsequent errors are treated as args.
                    error: hsData.find(d => d instanceof Error)?.message,
                    message: "", // Always filled out
                    args: hsData.length ? hsData : undefined,
                };

                if (typeof firstArg === "string") {
                    result.message = firstArg;
                }
                else if (firstArg instanceof Error) {
                    result.message = firstArg.message;
                }
                else {
                    result.message = util.inspect(firstArg);
                }

                return result;
            });
            formatters.push(formatter(), winston.format.json());
        }
        else {
            formatters.push(winston.format.printf(i => Logger.messageFormatter(i as LogEntry)));
        }

        const formatter = winston.format.combine(...formatters);

        const transports: winston.transport[] = [];

        if (debugStream) {
            transports.push(new winston.transports.Stream({
                stream: debugStream,
                format: formatter,
                level: 'debug',
            }));
        }

        if (cfg.console) {
            transports.push(
                new winston.transports.Console({
                    format: formatter,
                    level: cfg.console,
                })
            )
        }

        const files = 'files' in cfg && new Map(Object.entries(cfg.files));

        if (files) {
            // `winston-daily-rotate-file` has side-effects, so only load if in use.
            // unless they want to use logging
            require("winston-daily-rotate-file");
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { DailyRotateFile } = require("winston/lib/winston/transports");

            for (const [filename, level] of files) {
                transports.push(new DailyRotateFile({
                    filename,
                    datePattern: cfg.fileDatePattern,
                    level,
                    maxFiles: cfg.maxFiles,
                }));
            }
        }

        this.winstonLog = winston.createLogger({
            transports: transports,
        });

        LogService.setLogger(this.botSdkLogger);

        // We filter the logging out in winston.
        LogService.setLevel(BotSdkLogLevel.DEBUG);
        LogService.debug("LogWrapper", "Reconfigured logging");
        this.isConfigured = true;
    }

    /**
     * Logging implementation which can be provided to a bot-sdk LogService
     * instance to pipe logs through this component. **Note**: This is done automatically
     * for the `matrix-appservice-bridge`'s instance of the bot-sdk, but if you
     * use the bot-sdk directly in your bridge you should use the example code below
     * @example
     * ```
     * import { LogService } from "matrix-bot-sdk";
     * Logger.configure({...})
     * LogService.setLogger(Logger.logServiceLogger);
     * ```
     */
    public get botSdkLogger(): ILogger {
        const log = this.winstonLog;
        if (!log) {
            throw Error('Logging is not configured yet');
        }

        function formatBotSdkMessage(module: string, ...messageOrObject: LogEntryPart[]) {
            return {
                module,
                data: [Logger.formatLogEntryPartArray(messageOrObject)]
            };
        }

        return {
            info: (module: string, ...messageOrObject: LogEntryPart[]) => {
                // These are noisy, redirect to debug.
                if (module.startsWith("MatrixLiteClient") || module.startsWith("MatrixHttpClient")) {
                    log.log("debug", formatBotSdkMessage(module, ...messageOrObject));
                    return;
                }
                log.log("info", formatBotSdkMessage(module, ...messageOrObject));
            },
            warn: (module: string, ...messageOrObject: LogEntryPart[]) => {
                if (isMessageNoise(messageOrObject)) {
                    log.log("debug", formatBotSdkMessage(module, ...messageOrObject));
                    return;
                }
                log.log("warn", formatBotSdkMessage(module, ...messageOrObject));
            },
            error: (module: string, ...messageOrObject: LogEntryPart[]) => {
                if (isMessageNoise(messageOrObject)) {
                    log.log("debug", formatBotSdkMessage(module, ...messageOrObject));
                    return;
                }
                log.log("error", formatBotSdkMessage(module, ...messageOrObject));
            },
            debug: (module: string, ...messageOrObject: LogEntryPart[]) => {
                log.log("debug", formatBotSdkMessage(module, ...messageOrObject));
            },
            trace: (module: string, ...messageOrObject: LogEntryPart[]) => {
                log.log("verbose", formatBotSdkMessage(module, ...messageOrObject));
            },
        }
    }
}

interface LoggerMetadata {
    requestId?: string;
}

export class Logger {
    static readonly root = new GlobalLogger();

    static formatLogEntryPartArray(...data: LogEntryPart[]): string {
        data = data.flat();
        return data.map(obj => {
            if (typeof obj === "string") {
                return obj;
            }
            return util.inspect(obj);
        }).join(" ");
    }

    static messageFormatter(info: LogEntry): string {
        const logPrefix = [
            info.level,
            info.timestamp,
            `[${info.module}]`,
            info.requestId,
        ].join('');
        return logPrefix + this.formatLogEntryPartArray(info.data ?? []);
    }

    /**
     * Configure the root logger instance.
     * @param cfg The configuration parameters
     */
    public static configure(cfg: LoggingOpts|LoggingOptsFile) {
        this.root.configureLogging(cfg);
    }

    public static get botSdkLogger() { return this.root.botSdkLogger; }

    constructor(
        private readonly module: string,
        private readonly additionalMeta: LoggerMetadata = {},
        private readonly logger: GlobalLogger = Logger.root) {
    }

    private get logMeta() {
        return {
            module: this.module,
            requestId: this.additionalMeta.requestId,
        }
    }

    /**
     * Logs to the DEBUG channel
     * @param msg The message or data to log.
     * @param additionalData Additional context.
     */
    public debug(msg: LogEntryPart, ...additionalData: LogEntryPart[]) {
        this.logger.winston?.log("debug", {...this.logMeta, data: [msg, ...additionalData]});
    }

    /**
     * Logs to the ERROR channel
     * @param msg The message or data to log.
     * @param additionalData Additional context.
     */
    public error(msg: LogEntryPart, ...additionalData: LogEntryPart[]) {
        this.logger.winston?.log("error", { ...this.logMeta, data: [msg, ...additionalData] });
    }

    /**
     * Logs to the INFO channel
     * @param msg The message or data to log.
     * @param additionalData Additional context.
     */
    public info(msg: LogEntryPart, ...additionalData: LogEntryPart[]) {
        this.logger.winston?.log("info", {...this.logMeta, data: [msg, ...additionalData] });
    }

    /**
     * Logs to the WARN channel
     * @param msg The message or data to log.
     * @param additionalData Additional context.
     */
    public warn(msg: LogEntryPart, ...additionalData: LogEntryPart[]) {
        this.logger.winston?.log("warn", {...this.logMeta, data: [msg, ...additionalData] });
    }
}
