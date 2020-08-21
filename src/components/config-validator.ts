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
import * as fs from "fs";
import yaml from "js-yaml";
import validator from "is-my-json-valid";
import extend from "extend";

type Schema = any;

export default class ConfigValidator {

    /**
     * Construct a validator of YAML files.
     * @param schema The JSON schema file object.
     */
    constructor (private schema: Schema) { }

    /**
     * Validate the input config.
     * @param {string|Object} inputConfig The input config file path (string) or
     * parsed config (Object).
     * @param {Object=} defaultConfig The default config options.
     * @return {Object} The input config with defaults applied.
     * @throws On validation errors
     */
    public validate(inputConfig: string|Schema, defaultConfig: Record<string, unknown> = {}) {
        defaultConfig = defaultConfig || {};
        if (typeof inputConfig === "string") {
            inputConfig = ConfigValidator.loadFromFile(inputConfig);
        }
        const js = validator(this.schema, {
            verbose: true,
        });
        const res = js(inputConfig, this.schema);
        if (!res) {
            js.errors.forEach(error => {
                console.error(JSON.stringify(error));
                console.error(`The field ${error.field} is ${error.value}` +
                            ` which ${error.message}`);
            });
            // This is a bit awful, but it's how we return validation errors.
            const e: any = new Error("Failed to validate file");
            e._validationErrors = js.errors;
            throw e;
        }
        // mux in the default config
        return extend(true, defaultConfig, inputConfig);
    }

    private static loadFromFile(filename: string): Schema {
        const result = yaml.safeLoad(fs.readFileSync(filename, 'utf8'));
        if (typeof(result) !== "object") {
            throw Error('Was expecting yaml as an object');
        }
        return result;
    }

    private static fromSchemaFile(filename: string): ConfigValidator {
        return new ConfigValidator(ConfigValidator.loadFromFile(filename));
    }
}

module.exports = ConfigValidator;
