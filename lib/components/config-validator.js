"use strict";
const fs = require("fs");
const yaml = require("js-yaml");
const Validator = require("is-my-json-valid");
const extend = require("extend");

/**
 * Construct a validator of YAML files.
 * @constructor
 * @param {string|Object} schema The JSON schema file (as YAML) or object.
 */
function ConfigValidator(schema) {
    this.schema = schema;
    this.watcher = null;
    if (typeof schema === "string") {
        this.schema = this._loadFromFile(schema);
    }
}

/**
 * Validate the input config.
 * @param {string|Object} inputConfig The input config file path (string) or
 * parsed config (Object).
 * @param {Object=} defaultConfig The default config options.
 * @return {Object} The input config with defaults applied.
 * @throws On validation errors
 */
ConfigValidator.prototype.validate = function(inputConfig, defaultConfig) {
    defaultConfig = defaultConfig || {};
    if (typeof inputConfig === "string") {
        inputConfig = this._loadFromFile(inputConfig);
    }
    const js = Validator(this.schema, {
        verbose: true,
    });
    const res = js(inputConfig, this.schema);
    if (!res) {
        js.errors.forEach(function(error) {
            console.error(JSON.stringify(error));
            console.error(`The field ${error.field} is ${error.value}` +
                          ` which ${error.message}`);
        });
        var e = new Error("Failed to validate file");
        e._validationErrors = errors;
        throw e;
    }
    // mux in the default config
    return extend(true, defaultConfig, inputConfig);
}

ConfigValidator.prototype.watchForChanges = function(filename, cb) {
    this.watcher = fs.watch(filename, { encoding: 'utf8' });
    this.watcher.on("change", cb);
}

ConfigValidator.prototype.stopWatching = function() {
    if (this.watcher) {
        this.watcher.close();
        this.watcher = null;
    }
}

ConfigValidator.prototype._loadFromFile = function(filename) {
    return yaml.safeLoad(fs.readFileSync(filename, 'utf8'));
};

module.exports = ConfigValidator;
