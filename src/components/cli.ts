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
import path from "path";
import * as yaml from "js-yaml";
import nopt from "nopt";
import { AppServiceRegistration } from "matrix-appservice";
import ConfigValidator from "./config-validator";
import * as logging from "./logging";

const DEFAULT_PORT = 8090;
const DEFAULT_FILENAME = "registration.yaml";
const log = logging.get("cli");

interface CliOpts<ConfigType extends Record<string, unknown>> {
    run: (port: number, config: ConfigType|null, registration: AppServiceRegistration|null) => void;
    generateRegistration?: (reg: AppServiceRegistration, cb: (finalReg: AppServiceRegistration) => void) => void;
    bridgeConfig?: {
        affectsRegistration?: boolean;
        schema: string|Record<string, unknown>;
        defaults: string|Record<string, unknown>;
    };
    registrationPath: string;
    enableRegistration?: boolean;
    enableLocalpart: boolean;
    port: number;
}

interface CliArgs {
    "generate-registration": boolean;
    config: string;
    url: string;
    localpart: string;
    port: number;
    file: string;
    help: boolean;
}

export class Cli<ConfigType extends Record<string, unknown>> {
    private bridgeConfig: ConfigType|null = null;
    private args: CliArgs|null = null;

    /**
     * @constructor
     * @param opts CLI options
     * @param opts.run The function called when you should run the bridge.
     * @param opts.generateRegistration The function
     * called when you should generate a registration.
     * @param opts.bridgeConfig Bridge-specific config info. If null, no
     * --config option will be present in the CLI. Default: null.
     * @param opts.bridgeConfig.affectsRegistration True to make the
     * --config option required when generating the registration. The parsed config
     * can be accessed via <code>Cli.getConfig()</code>.
     * @param opts.bridgeConfig.schema Path to a schema YAML file
     * (string) or the parsed schema file (Object).
     * @param opts.bridgeConfig.defaults The default options for the
     * config file.
     * @param opts.enableRegistration Enable '--generate-registration'.
     * Default True.
     * @param opts.registrationPath The path to write the registration
     * file to. Users can overwrite this with -f.
     * @param opts.enableLocalpart Enable '--localpart [-l]'. Default: false.
     */
    constructor(private opts: CliOpts<ConfigType>) {
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
    }
    /**
     * Get the parsed arguments. Only set after run is called and arguments parsed.
     * @return The parsed arguments
     */
    public getArgs() {
        return this.args;
    }
    /**
     * Get the loaded and parsed bridge config. Only set after run() has been called.
     * @return The config
     */
    public getConfig() {
        return this.bridgeConfig;
    }

    /**
     * Get the path to the registration file. This may be different to the one supplied
     * in the constructor if the user passed a -f flag.
     * @return The path to the registration file.
     */
    public getRegistrationFilePath() {
        return this.opts.registrationPath;
    }

    /**
     * Run the app from the command line. Will parse sys args.
     */
    public run() {
        this.args = nopt({
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
            // We know the typings will be correct.
        }) as unknown as CliArgs;

        if (this.args.file) {
            this.opts.registrationPath = this.args.file;
        }

        if (this.opts.enableRegistration && this.args["generate-registration"]) {
            if (!this.args.url) {
                this.printHelp();
                console.log("Missing --url [-u]");
                process.exit(1);
            }
            if (this.args.port) {
                this.printHelp();
                console.log("--port [-p] is not valid when generating a registration file.");
                process.exit(1);
            }
            if (this.opts.bridgeConfig && this.opts.bridgeConfig.affectsRegistration) {
                if (!this.args.config) {
                    this.printHelp();
                    console.log("Missing --config [-c]");
                    process.exit(1);
                }
                this.assignConfigFile(this.args.config);
            }
            this.generateRegistration(this.args.url, this.args.localpart);
            return;
        }

        if (this.args.help || (this.opts.bridgeConfig && !this.args.config)) {
            this.printHelp();
            process.exit(0);
            return;
        }
        if (this.args.localpart) {
            this.printHelp();
            console.log(
                "--localpart [-l] can only be provided when generating a registration."
            );
            process.exit(1);
            return;
        }

        if (this.args.port) {
            this.opts.port = this.args.port;
        }
        this.assignConfigFile(this.args.config);
        this.startWithConfig(this.bridgeConfig);
    }

    private assignConfigFile(configFilePath: string) {
        const configFile = (this.opts.bridgeConfig && configFilePath) ? configFilePath : undefined;
        const config = this.loadConfig(configFile);
        this.bridgeConfig = config;
    }

    private loadConfig(filename?: string): ConfigType|null {
        if (!filename) { return null; }
        log.info("Loading config file %s", filename);
        const cfg = this.loadYaml(filename);
        if (!cfg || typeof cfg === "string") {
            throw Error("Config file " + filename + " isn't valid YAML.");
        }
        if (!this.opts.bridgeConfig?.schema) {
            return cfg as ConfigType;
        }
        const validator = new ConfigValidator(this.opts.bridgeConfig.schema);
        return validator.validate(cfg, this.opts.bridgeConfig.defaults) as ConfigType;
    }

    private generateRegistration(appServiceUrl: string, localpart: string) {
        if (!appServiceUrl) {
            throw Error("Missing app service URL");
        }
        let reg = new AppServiceRegistration(appServiceUrl);
        if (localpart) {
            reg.setSenderLocalpart(localpart);
        }
        if (!this.opts.generateRegistration) {
            throw Error('No generateRegistraton function provided');
        }
        this.opts.generateRegistration.bind(this)(reg, (completeReg) => {
            reg = completeReg;
            reg.outputAsYaml(this.opts.registrationPath);
            log.info("Output registration to: " + this.opts.registrationPath);
            process.exit(0);
        });
    }

    private startWithConfig(config: ConfigType|null) {
        this.opts.run(
            this.opts.port, config,
            AppServiceRegistration.fromObject(this.loadYaml(this.opts.registrationPath))
        );
    }

    private loadYaml(fpath: string) {
        return yaml.safeLoad(fs.readFileSync(fpath, 'utf8'));
    }

    private printHelp() {
        const help: {[flag: string]: string} = {
            "--help -h": "Display this help message",
            "--file -f": "The registration file to load or save to."
        };
        const appPart = (process.argv[0] === "node" ?
            // node file/path
            (process.argv[0] + " " + path.relative(process.cwd(), process.argv[1])) :
            // app-name
            process.argv[0]
        );
        const usages = [];

        if (this.opts.enableRegistration) {
            help["--generate-registration -r"] = "Create a registration YAML file " +
            "for this application service";
            help["--url -u"] = "Registration Option. Required if -r is set. The URL " +
            "where the application service is listening for HS requests";
            if (this.opts.enableLocalpart) {
                help["--localpart -l"] = "Registration Option. Valid if -r is set. " +
                "The user_id localpart to assign to the AS.";
            }
            let regUsage = "-r [-f /path/to/save/registration.yaml] " +
                "-u 'http://localhost:6789'";
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
    }
}
