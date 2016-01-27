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
 * @param {Cli~runBridge} opts.run The function called when you should run the bridge.
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
 * file to. Users can overwrite this with -f.
 * @param {boolean=} opts.enableLocalpart Enable '--localpart [-l]'. Default: false.
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
    this.opts.enableLocalpart = Boolean(this.opts.enableLocalpart);

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
 * Get the path to the registration file. This may be different to the one supplied
 * in the constructor if the user passed a -f flag.
 * @return {string} The path to the registration file.
 */
Cli.prototype.getRegistrationFilePath = function() {
    return this.opts.registrationPath;
};

/**
 * Run the app from the command line. Will parse sys args.
 */
Cli.prototype.run = function() {
    var args = nopt({
        "generate-registration": Boolean,
        "config": path,
        "url": String,
        "localpart": String,
        "port": Number,
        "file": path,
        "help": Boolean
    }, {
        "c": "--config",
        "u": "--url",
        "r": "--generate-registration",
        "l": "--localpart",
        "p": "--port",
        "f": "--file",
        "h": "--help"
    });

    if (args.file) {
        this.opts.registrationPath = args.file;
    }

    if (this.opts.enableRegistration && args["generate-registration"]) {
        if (!args.url) {
            this._printHelp();
            console.log("Missing --url [-u]");
            process.exit(1);
        }
        if (args.port) {
            this._printHelp();
            console.log("--port [-p] is not valid when generating a registration file.");
            process.exit(1);
        }
        if (this.opts.bridgeConfig && this.opts.bridgeConfig.affectsRegistration) {
            if (!args.config) {
                this._printHelp();
                console.log("Missing --config [-c]");
                process.exit(1);
            }
            this._assignConfigFile(args.config);
        }
        this._generateRegistration(args.url, args.localpart);
        return;
    }

    if (args.help || (this.opts.bridgeConfig && !args.config)) {
        this._printHelp();
        process.exit(0);
        return;
    }
    if (args.localpart) {
        this._printHelp();
        console.log(
            "--localpart [-l] can only be provided when generating a registration."
        );
        process.exit(1);
        return;
    }

    if (args.port) {
        this.opts.port = args.port;
    }
    this._assignConfigFile(args.config);
    this._startWithConfig(this._bridgeConfig);
};

Cli.prototype._assignConfigFile = function(configFilePath) {
    var configFile = (this.opts.bridgeConfig && configFilePath) ? configFilePath : null;
    var config = this._loadConfig(configFile);
    this._bridgeConfig = config;
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

Cli.prototype._generateRegistration = function(appServiceUrl, localpart) {
    if (!appServiceUrl) {
        throw new Error("Missing app service URL");
    }
    var self = this;
    var reg = new AppServiceRegistration(appServiceUrl);
    if (localpart) {
        reg.setSenderLocalpart(localpart);
    }
    this.opts.generateRegistration.bind(this)(reg, function(completeReg) {
        reg = completeReg;
        reg.outputAsYaml(self.opts.registrationPath);
        console.log("Output registration to: " + self.opts.registrationPath);
        process.exit(0);
    });
};

Cli.prototype._startWithConfig = function(config) {
    this.opts.run(
        this.opts.port, config,
        AppServiceRegistration.fromObject(this._loadYaml(this.opts.registrationPath))
    );
};

Cli.prototype._loadYaml = function(fpath) {
    return yaml.safeLoad(fs.readFileSync(fpath, 'utf8'));
};

Cli.prototype._printHelp = function() {
    var help = {
        "--help -h": "Display this help message",
        "--file -f": "The registration file to load or save to."
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
        help["--url -u"] = "Registration Option. Required if -r is set. The URL " +
        "where the application service is listening for HS requests";
        if (this.opts.enableLocalpart) {
            help["--localpart -l"] = "Registration Option. Valid if -r is set. " +
            "The user_id localpart to assign to the AS.";
        }
        var regUsage = "-r [-f /path/to/save/registration.yaml] " +
            "-u 'http://localhost:6789/appservice'";
        if (this.opts.bridgeConfig && this.opts.bridgeConfig.affectsRegistration) {
            regUsage += " -c CONFIG_FILE";
        }
        if (this.opts.enableLocalpart) {
            regUsage += " [-l my-app-service]";
        }
        usages.push(regUsage);
    }
    if (this.opts.bridgeConfig) {
        help["--config -c"] = "The config file to load";
        usages.push("-c CONFIG_FILE [-f /path/to/load/registration.yaml] [-p NUMBER]");
    }
    else {
        usages.push("[-f /path/to/load/registration.yaml] [-p NUMBER]");
    }
    help["--port -p"] = "The port to listen on for HS requests";

    console.log("Usage:\n");
    console.log("Generating an application service registration file:");
    console.log("%s %s\n", appPart, usages[0]);
    console.log("Running an application service with an existing registration file:");
    console.log("%s %s", appPart, usages[1]);

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

 /**
 * Invoked when you should run the bridge.
 * @callback Cli~runBridge
 * @param {Number} port The port to listen on.
 * @param {?Object} config The loaded and parsed config.
 * @param {AppServiceRegistration} reg The registration to run as.
 * @example
 * runBridge: function(port, config, reg) {
 *   // configure bridge
 *   // listen on port
 * }
 */
