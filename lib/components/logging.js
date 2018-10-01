const util = require("util");

let winston = null;
try {
    winston = require("winston");
} catch (ex) {
    // Missing winston, which is fine.
    if (ex.message !== "Cannot find module 'winston'") {
        throw ex;
    }
}

if (winston) {
    require('winston-daily-rotate-file');
    moment = require("moment");
}

class Logging {
    constructor() {
        this.loggers = new Map();
        this.transports = null;
    }

    /*
        config:
            console: "error|warn|info|debug|off"
            fileDatePattern: "YYYY-MM-DD",
            timestampFormat: "MMM-D HH:mm:ss.SSS"
            files: {
                "abc.log" => "error|warn|info|debug|off"
            }
            maxFiles: 5
    */
    Configure(config) {
        if (!config.fileDatePattern) {
            config.fileDatePattern = "YYYY-MM-DD";
        }
        if (!config.timestampFormat){
            config.timestampFormat = "MMM-D HH:mm:ss.SSS";
        }

        let updatingLoggers = false;
        const timestampFn = () => {
            return moment().format(config.timestampFormat);
        };
        const formatterFn = function(opts) {
            return opts.timestamp() + ' ' +
            opts.level.toUpperCase() + ':' +
            (opts.meta && opts.meta.loggerName ? opts.meta.loggerName : "") + ' ' +
            (undefined !== opts.message ? opts.message : '');
        };

        this.transports = [];
        if (config.console !== undefined && config.console !== "off") {
            this.transports.push(new (winston.transports.Console)({
                json: false,
                name: "console",
                timestamp: timestampFn,
                formatter: formatterFn,
                level: config.console
            }));
        }

        if (config.files !== undefined) {
            let i = 0;
            for (let file of config.files) {
                const filename = Object.keys(file)[0];
                const level = file[filename];
                i++;
                this.transports.push(new (winston.transports.DailyRotateFile)({
                    filename,
                    datePattern: config.fileDatePattern,
                    name: `logfile` + i,
                    formatter: formatterFn,
                    level,
                    timestamp: timestampFn,
                    maxFiles: config.maxFiles > 0 ? config.maxFiles : undefined
                }));
            }
        }

        this.loggers.forEach((wrapper, name) => {
            wrapper.setLogger(this.createLogger(name));
        });
    }

    Get(name) {
        if (!this.loggers.has(name)) {
            const wrapper = new LogWrapper()
            this.loggers.set(name, wrapper);
            /* We won't assign create and assign a logger until
             * the transports are ready */
            if (this.transports !== null) {
                wrapper.setLogger(this.createLogger(name));
            }
        }
        return this.loggers.get(name);
    }

    createLogger(name) {
        const logger =  new (winston.Logger)({
            transports: this.transports,
            // winston doesn't support getting the logger category from the
            // formatting function, which is a shame. Instead, write a rewriter
            // which sets the 'meta' info for the logged message with the loggerName
            rewriters: [
                function(level, msg, meta = {}) {
                    meta.loggerName = name;
                    return meta;
                }
            ]
        });
        return logger;
    }
}

class LogWrapper {
    constructor() {
        this.logger = null;
        this.messages = []; // {type: string, messageParts: [object]}
    }

    setLogger(logger) {
        this.logger = logger;
    }

    debug(...messageParts) { this._log(messageParts, 'debug') };

    info(...messageParts) { this._log(messageParts, 'info') };

    warn(...messageParts) { this._log(messageParts, 'warn') };

    error(...messageParts) { this._log(messageParts, 'error') };

    _formatParts(messageParts) {
        return messageParts.map((part) => {
            if (typeof(part) === "object") {
                return util.inspect(part);
            }
            return part;
        });
    }

    _log(messageParts, type) {
        messageParts = this._formatParts(messageParts);
        if (this.logger == null) {
            this.messages.push({type, messageParts});
            return;
        } else {
            /* When we first start logging, the transports
             * won't be configured so we push to a queue.
             * When the transport becomes ready, the queue
             * is emptied. */
            while (this.messages.length > 0) {
                const msg = this.messages[0];
                this.logger[msg.type](...msg.messageParts);
                this.messages.splice(0,1);
            }
        }
        this.logger[type](...messageParts);
    }
}

/* Setup a basic instance first, which will become a new instance
   when things go wrong.
*/
let instance;
if (winston) {
    instance = new Logging();
} else {
    // We don't have winston, so just log to the console.
    instance = {
        Get: (name) => {;
            const logWrapper = new LogWrapper();
            // Console has all the functions already.
            logWrapper.setLogger(console);
            return logWrapper;
        },
        Configure: () => {
            // No-op this.
        },
    };
}

module.exports = {
    Get: (name) => {
        return instance.Get(name);
    },

    Configure: (config) => {
        instance.Configure(config);
    }
}
