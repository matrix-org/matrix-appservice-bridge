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
import { LogLevel, LogService } from "matrix-bot-sdk";
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

		const possibleError = messageOrObject as { error?: string, body?: { error?: string}, errcode?: string}

		const error = possibleError?.error || possibleError?.body?.error;
		const errcode = possibleError?.errcode;

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

export interface LoggingOpts {
    level: "debug"|"info"|"warn"|"error"|"trace";
    json?: boolean;
    colorize?: boolean;
    timestampFormat?: string;
}

export interface CustomLoggingOpts {
    logger: CustomLogger;
    level: "debug"|"info"|"warn"|"error"|"trace";
}

interface LoggingMetadata {
	requestId?: string;
}

export class Logger {
	public static log?: winston.Logger|CustomLogger;

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
    private static configureWinston(cfg: LoggingOpts): winston.Logger {
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
            formatters.push(winston.format.json());
        }
        else {
            formatters.push(winston.format.printf(
                (info) => {
                    return `${info.level} ${info.timestamp} [${info.module}] ${info.reqId} ${info.message}`;
                },
            ));
        }

		if (this.log && 'close' in this.log) {
			this.log.close();
		}

        return winston.createLogger({
            level: cfg.level,
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
    public static configureLogging(cfg: LoggingOpts|CustomLoggingOpts): void {
        const log = this.log = 'logger' in cfg ? cfg.logger : this.configureWinston(cfg);

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
        LogService.setLevel(LogLevel.fromString(cfg.level));
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
		Logger.log?.debug(Logger.formatMessageString(messageOrObject), { module: this.module, ...this.metadata });
    }

    /**
     * Logs to the INFO channel
     * @param {*[]} messageOrObject The data to log
     */
    public info(...messageOrObject: unknown[]): void {
		Logger.log?.info(Logger.formatMessageString(messageOrObject), { module: this.module, ...this.metadata });
    }

    /**
     * Logs to the WARN channel
     * @param {*[]} messageOrObject The data to log
     */
    public warn(...messageOrObject: unknown[]): void {
        Logger.log?.warn(Logger.formatMessageString(messageOrObject), { module: this.module, ...this.metadata });
    }

    /**
     * Logs to the ERROR channel
     * @param {*[]} messageOrObject The data to log
     */
    public error(...messageOrObject: unknown[]): void {
		Logger.log?.error(Logger.formatMessageString(messageOrObject), { module: this.module, ...this.metadata });
    }
}
