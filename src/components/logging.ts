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
import { LogService } from "matrix-bot-sdk";
import util from "util";
import winston, { format } from "winston";

/**
 * Tries to filter out noise from the bot-sdk.
 * @param messageOrObjects A list of values being logged.
 * @returns True is the message is noise, or false otherwise.
 */
function isMessageNoise(messageOrObjects: unknown[]) {
	return !!messageOrObjects.find(messageOrObject => {
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

interface LoggingMetadata {
	requestId?: string;
}

export class Logger {
	public static innerLog?: winston.Logger|CustomLogger;

	public static formatMessageString(messageOrObject: unknown[]): string {
		return messageOrObject.flat().map(value => {
			if (typeof(value) === "object") {
				return util.inspect(value);
			}
			return value;
		}).join(" ");
	}

    /**
     * Configure the winston logger.
     * @param cfg The configuration for the logger.
     * @returns A winston logger
     */
    private static configureWinston(cfg: LoggingOpts|LoggingOptsFile): winston.Logger {
        const formatters = [
            winston.format.timestamp({
                format: cfg.timestampFormat || "HH:mm:ss:SSS",
            }),
            (format((info) => {
                info.level = info.level.toUpperCase();
                return info;
            }))(),
            (format((info) => {
                info.requestId = info.requestId ? info.requestId + " " : "";
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
            formatters.push(winston.format.json());
        }
        else {
            formatters.push(winston.format.printf(
                (info) => `${info.level} ${info.timestamp} [${info.module}] ${info.requestId}${info.message}`,
            ));
        }

		if (this.innerLog && 'close' in this.innerLog) {
			this.innerLog.close();
		}

        const transports: winston.transport[] = [];

        if (cfg.console) {
            transports.push(new winston.transports.Console({
                format: winston.format.combine(...formatters),
            }));
        }

        if ('files' in cfg) {
            // `winston-daily-rotate-file` has side-effects, so only load if in use.
            // unless they want to use logging
            require("winston-daily-rotate-file");
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const { DailyRotateFile } = require("winston/lib/winston/transports");

            for (const [filename, level] of Object.entries(cfg.files)) {
                transports.push(new DailyRotateFile({
                    filename,
                    datePattern: cfg.fileDatePattern,
                    level,
                    maxFiles: cfg.maxFiles,
                }));
            }
        }


        return winston.createLogger({
            level: cfg.console,
            transports: [
                new winston.transports.Console({
                    format: winston.format.combine(...formatters),
                }),
            ],
        });
    }

    /**
     * (Re)configure the logging service. If Winston was previously configured,
     * it will be closed and reconfigured.
     * @param cfg
     */
    public static configure(cfg: LoggingOpts|LoggingOptsFile|CustomLoggingOpts): void {
        const log = this.innerLog = 'logger' in cfg ? cfg.logger : this.configureWinston(cfg);

		// Configure matrix-bot-sdk
        LogService.setLogger({
            trace: (module: string, ...messageOrObject: unknown[]) => {
                log.verbose(Logger.formatMessageString(messageOrObject), { module });
            },
            debug: (module: string, ...messageOrObject: unknown[]) => {
                log.debug(Logger.formatMessageString(messageOrObject), { module });
            },
            info: (module: string, ...messageOrObject: unknown[]) => {
                if (module.startsWith("MatrixLiteClient")) {
                    // The MatrixLiteClient module is quite noisy about the requests it makes
                    // send non-errors to debug.
                    log.debug(Logger.formatMessageString(messageOrObject), { module });
                    return;
                }
                log.info(Logger.formatMessageString(messageOrObject), { module });
            },
            warn: (module: string, ...messageOrObject: unknown[]) => {
                if (isMessageNoise(messageOrObject)) {
                    log.debug(Logger.formatMessageString(messageOrObject), { module });
                    return;
                }
                log.warn(Logger.formatMessageString(messageOrObject), { module });
            },
            error: (module: string, ...messageOrObject: unknown[]) => {
                if (isMessageNoise(messageOrObject)) {
                    log.debug(Logger.formatMessageString(messageOrObject), { module });
                    return;
                }
                log.error(Logger.formatMessageString(messageOrObject), { module });
            },
        });
        LogService.debug("LogWrapper", "Reconfigured logging");
    }

	/**
	 * @param module The module logging the information.
	 * @param metadata Any additional metadata about this specific logger instance.
	 */
    constructor(private module: string, private metadata: LoggingMetadata = {}) { }

    /**
     * Logs to the DEBUG channel
     * @param {*[]} messageOrObject The data to log
     */
    public debug(...messageOrObject: unknown[]): void {
		Logger.innerLog?.debug(Logger.formatMessageString(messageOrObject), { module: this.module, ...this.metadata });
    }

    /**
     * Logs to the INFO channel
     * @param {*[]} messageOrObject The data to log
     */
    public info(...messageOrObject: unknown[]): void {
		Logger.innerLog?.info(Logger.formatMessageString(messageOrObject), { module: this.module, ...this.metadata });
    }

    /**
     * Logs to the WARN channel
     * @param {*[]} messageOrObject The data to log
     */
    public warn(...messageOrObject: unknown[]): void {
        Logger.innerLog?.warn(Logger.formatMessageString(messageOrObject), { module: this.module, ...this.metadata });
    }

    /**
     * Logs to the ERROR channel
     * @param {*[]} messageOrObject The data to log
     */
    public error(...messageOrObject: unknown[]): void {
		Logger.innerLog?.error(Logger.formatMessageString(messageOrObject), { module: this.module, ...this.metadata });
    }
}
