"use strict";
var AppServiceRegistration = require("matrix-appservice").AppServiceRegistration;
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
 * @param {Function} opts.run The function called when you should run the bridge.
 * The first arg is the port to listen on. The second are is the parsed config
 * object if set.
 * @param {Cli~generateRegistration} opts.generateRegistration The function
 * called when you should generate a registration.
 * @param {Object=} opts.bridgeConfig Bridge-specific config info. If null, no
 * --config option will be present in the CLI. Default: null.
 * @param {boolean=} opts.bridgeConfig.affectsRegistration True to make the
 * --config option required when generating the registration. The parsed config
 * can be accessed via <code>Cli.getConfig()</code>.
 * @param {string|Object=} opts.bridgeConfig.schema Path to a schema YAML file
 * (string) or the parsed schema file (Object).
 * @param {Object=} opts.bridgeConfig.defaults The default options for the
 * config file.
 * @param {boolean=} opts.enableRegistration Enable '--generate-registration'.
 * Default True.
 * @param {string=} opts.registrationPath The path to write the registration
 * file to.
 */
function Cli(opts) {
    this.opts = opts || {};
    if (this.opts.enableRegistration === undefined) {
        this.opts.enableRegistration = true;
    }
    if (!this.opts.run || typeof this.opts.run !== "function") {
        throw new Error("Requires 'run' function.");
    }

    if (this.opts.enableRegistration && !this.opts.generateRegistration) {
        throw new Error(
            "Registration generation is enabled but no " +
            "'generateRegistration' function has been provided"
        );
    }

    this.opts.registrationPath = this.opts.registrationPath || DEFAULT_FILENAME;
    this.opts.port = this.opts.port || DEFAULT_PORT;
    this._bridgeConfig = null;
}

/**
 * Get the loaded and parsed bridge config. Only set after run() has been called.
 * @return {?Object} The config
 */
Cli.prototype.getConfig = function() {
    return this._bridgeConfig;
};

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

    if (opts.help || (this.opts.bridgeConfig && !opts.config)) {
        this._printHelp();
        process.exit(0);
        return;
    }
    if (opts.port) {
        this.opts.port = opts.port;
    }
    var configFile = (this.opts.bridgeConfig && opts.config) ? opts.config : null;
    var config = this._loadConfig(configFile);
    this._bridgeConfig = config;
    this._startWithConfig(config);
};

Cli.prototype._loadConfig = function(filename) {
    if (!filename) { return {}; }
    console.log("Loading config file %s", filename);
    var cfg = this._loadYaml(filename);
    if (typeof cfg === "string") {
        throw new Error("Config file " + filename + " isn't valid YAML.");
    }
    if (!this.opts.bridgeConfig.schema) {
        return cfg;
    }
    var validator = new ConfigValidator(this.opts.bridgeConfig.schema);
    return validator.validate(cfg, this.opts.bridgeConfig.defaults);
};

Cli.prototype._generateRegistration = function(appServiceUrl) {
    if (!appServiceUrl) {
        throw new Error("Missing app service URL");
    }
    var self = this;
    var reg = new AppServiceRegistration(appServiceUrl);
    this.opts.generateRegistration(reg, function(completeReg) {
        reg = completeReg;
        reg.outputAsYaml(self.opts.registrationPath);
        process.exit(0);
    });
};

Cli.prototype._startWithConfig = function(config) {
    this.opts.run(this.opts.port, config);
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
    if (this.opts.bridgeConfig) {
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

/**
 * Invoked when you should generate a registration.
 * @callback Cli~generateRegistration
 * @param {AppServiceRegistration} reg A new registration object with the app
 * service url provided by <code>--url</code> set.
 * @param {Function} callback The callback that you should invoke when the
 * registration has been generated. It should be called with the
 * <code>AppServiceRegistration</code> provided in this function.
 * @example
 * generateRegistration: function(reg, callback) {
 *   reg.setHomeserverToken(AppServiceRegistration.generateToken());
 *   reg.setAppServiceToken(AppServiceRegistration.generateToken());
 *   reg.setSenderLocalpart("my_first_bot");
 *   callback(reg);
 * }
 */
