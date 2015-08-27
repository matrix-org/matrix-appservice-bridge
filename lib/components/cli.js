"use strict";
var nopt = require("nopt");
var path = require("path");

/**
 * @constructor
 * @param {Object} opts
 * @param {boolean} opts.enableConfig Default True.
 * @param {boolean} opts.enableRegistration Default True.
 */
function Cli(opts) {
    this.opts = opts || {};
    if (this.opts.enableRegistration === undefined) {
        this.opts.enableRegistration = true;
    }
    if (this.opts.enableConfig === undefined) {
        this.opts.enableConfig = true;
    }
}

/**
 * Run the app from the command line. Will parse sys args.
 */
Cli.prototype.run = function() {
    var opts = nopt({
        "generate-registration": Boolean,
        "config": path,
        "help": Boolean
    }, {
        "c": "--config",
        "r": "--generate-registration",
        "h": "--help"
    });

    if (this.opts.enableRegistration && opts["generate-registration"]) {
        this._generateRegistration();
        process.exit(0);
        return;
    }

    if (opts.help || (this.opts.enableConfig && !opts.config)) {
        this._printHelp();
        process.exit(0);
        return;
    }

    var configFile = (this.opts.enableConfig && opts.config) ? opts.config : null;
    var config = this._loadConfig(configFile);
    this._startWithConfig(config);
};

Cli.prototype._loadConfig = function(filename) {
    console.log("Loading config file %s", filename);
};

Cli.prototype._generateRegistration = function() {
    console.log("Generating registration");
};

Cli.prototype._startWithConfig = function(config) {
    console.log("Starting up...");
};

Cli.prototype._printHelp = function() {
    var help = {
        "--help -h": "Display this help message"
    };
    var appPart = (process.argv[0] === "node" ?
        (process.argv[0] + " " + process.argv[1]) :
        process.argv[0]
    );
    var usages = [];

    if (this.opts.enableRegistration) {
        help["--generate-registration -r"] = "Create a registration YAML file " +
        "for this application service";
        usages.push("-r");
    }
    if (this.opts.enableConfig) {
        help["--config -c"] = "The config file to load";
        usages.push("-c CONFIG_FILE");
    }
    else {
        usages.push("");
    }

    console.log("Usage:");
    usages.forEach(function(usage) {
        console.log("%s %s", appPart, usage);
    });

    console.log("\nOptions:");
    Object.keys(help).forEach(function(k) {
        console.log("  %s", k);
        console.log("      %s", help[k]);
    });
};

module.exports = Cli;
