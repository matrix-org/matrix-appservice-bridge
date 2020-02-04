/*
Copyright 2020 The Matrix.org Foundation C.I.C.

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
        e._validationErrors = js.errors;
        throw e;
    }
    // mux in the default config
    return extend(true, defaultConfig, inputConfig);
}

ConfigValidator.prototype._loadFromFile = function(filename) {
    return yaml.safeLoad(fs.readFileSync(filename, 'utf8'));
};

module.exports = ConfigValidator;
