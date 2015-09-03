"use strict";
var ConfigValidator = require("./config-validator");
var fs = require("fs");
var nopt = require("nopt");
var path = require("path");
var yaml = require("js-yaml");

var DEFAULT_PORT = 8090;
var DEFAULT_FILENAME = "registration.yaml";

/**
 * @constructor
 * @param {Object} opts CLI options
 * @param {Bridge} opts.bridge The bridge instance to invoke when running.
 * @param {Function} opts.generateRegistration The function called when you
 * should generate a registration. The first arg is the provided --url string,
 * the second arg is a callback function which
 * should be invoked with the AppServiceRegistration when the registration is
 * generated.
 * @param {boolean=} opts.enableConfig Enable '--config'. Default True.
 * @param {boolean=} opts.enableRegistration Enable '--generate-registration'.
 * Default True.
 * @param {string|Object=} opts.configSchema Path to a schema YAML file (string)
 * or the parsed schema file (Object).
 * @param {Object=} opts.configDefaults The default options for the config file.
 * @param {string=} opts.registrationPath The path to write the registration file
 * to.
 */
function Cli(opts) {
    this.opts = opts || {};
    if (this.opts.enableRegistration === undefined) {
        this.opts.enableRegistration = true;
    }
    if (this.opts.enableConfig === undefined) {
        this.opts.enableConfig = true;
    }
    if (!this.opts.bridge) {
        throw new Error("Requires 'bridge'.");
    }

    if (this.opts.enableRegistration && !this.opts.generateRegistration) {
        throw new Error(
            "Registration generation is enabled but no " +
            "'generateRegistration' function has been provided"
        );
    }

    this.opts.registrationPath = this.opts.registrationPath || DEFAULT_FILENAME;
    this.opts.port = this.opts.port || DEFAULT_PORT;
}

/**
 * Run the app from the command line. Will parse sys args.
 */
Cli.prototype.run = function() {
    var opts = nopt({
        "generate-registration": Boolean,
        "config": path,
        "url": String,
        "port": Number,
        "help": Boolean
    }, {
        "c": "--config",
        "u": "--url",
        "r": "--generate-registration",
        "p": "--port",
        "h": "--help"
    });

    if (this.opts.enableRegistration && opts["generate-registration"]) {
        if (!opts["url"]) {
            this._printHelp();
            console.log("Missing --url");
            process.exit(0);
        }
        this._generateRegistration(opts["url"]);
        return;
    }

    if (opts.help || (this.opts.enableConfig && !opts.config)) {
        this._printHelp();
        process.exit(0);
        return;
    }
    if (opts.port) {
        this.opts.port = opts.port;
    }
    var configFile = (this.opts.enableConfig && opts.config) ? opts.config : null;
    var config = this._loadConfig(configFile);
    this._startWithConfig(config);
};

Cli.prototype._loadConfig = function(filename) {
    if (!filename) { return {}; }
    console.log("Loading config file %s", filename);
    var cfg = this._loadYaml(filename);
    if (typeof cfg === "string") {
        throw new Error("Config file " + filename + " isn't valid YAML.");
    }
    if (!this.opts.configSchema) {
        return cfg;
    }
    var validator = new ConfigValidator(this.opts.configSchema);
    return validator.validate(cfg, this.opts.configDefaults);
};

Cli.prototype._generateRegistration = function(appServiceUrl) {
    if (!appServiceUrl) {
        throw new Error("Missing app service URL");
    }
    var self = this;
    this.opts.generateRegistration(appServiceUrl, function(reg) {
        reg.outputAsYaml(self.opts.registrationPath);
        process.exit(0);
    });
};

Cli.prototype._startWithConfig = function(config) {
    console.log("Starting up on port %s...", this.opts.port);
    this.opts.bridge.run(this.opts.port, config);
};

Cli.prototype._loadYaml = function(fpath) {
    return yaml.safeLoad(fs.readFileSync(fpath, 'utf8'));
};

Cli.prototype._printHelp = function() {
    var help = {
        "--help -h": "Display this help message"
    };
    var appPart = (process.argv[0] === "node" ?
        // node file/path
        (process.argv[0] + " " + path.relative(process.cwd(), process.argv[1])) :
        // app-name
        process.argv[0]
    );
    var usages = [];

    if (this.opts.enableRegistration) {
        help["--generate-registration -r"] = "Create a registration YAML file " +
        "for this application service";
        help["--url -u"] = "Required if -r is set. The URL where the " +
        "application service is listening for HS requests";
        usages.push("-r -u 'http://localhost:6789/appservice'");
    }
    if (this.opts.enableConfig) {
        help["--config -c"] = "The config file to load";
        usages.push("-c CONFIG_FILE [-p NUMBER]");
    }
    else {
        usages.push("[-p NUMBER]");
    }
    help["--port -p"] = "The port to listen on for HS requests";

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
