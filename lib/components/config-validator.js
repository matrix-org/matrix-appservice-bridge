"use strict";
var fs = require("fs");
var yaml = require("js-yaml");

/**
 * Construct a validator of YAML files.
 * @constructor
 * @param {string|Object} schema The JSON schema file (as YAML) or object.
 */
function ConfigValidator(schema) {
    this.schema = schema;
    if (typeof schema === "string") {
        this.schema = this._loadFromFile(schema);
    }
}

/**
 * Validate the input config.
 * @param {string|Object} The input config file path (string) or parsed config
 * (Object).
 * @param {Object=} The default config options.
 * @return {Object} The input config with defaults applied.
 * @throws On validation errors
 */
ConfigValidator.prototype.validate = function(inputConfig, defaulConfig) {
    defaulConfig = defaulConfig || {};
    if (typeof inputConfig === "string") {
        inputConfig = this._loadFromFile(inputConfig);
    }
    // TODO
    return inputConfig;
}

ConfigValidator.prototype._loadFromFile = function(filename) {
    return yaml.safeLoad(fs.readFileSync(filename, 'utf8'));
};

module.exports = ConfigValidator;
