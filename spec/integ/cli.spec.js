const fs = require("fs").promises;
const os = require("os");
const { Cli } = require("../..");
const { Logging } = require("../..");
const path = require('path');
const { defer } = require("../../lib/utils/promiseutil");
Logging.configure();

let tempDir;

const registrationFileContent = {
    id: "cli-test",
    url: "http://127.0.0.1:1234",
    as_token: "a_as_token",
    hs_token: "a_hs_token",
    sender_localpart: "the_sender",
    namespaces: {
        users: [{
            exclusive: true,
            regex: "@_the_bridge.*",
        }],
        aliases: [{
            exclusive: true,
            regex: "@_the_bridge.*",
        }],
        rooms: [],
    },
    rate_limited: false,
    protocols: [],
};
async function writeRegistrationFile(content=registrationFileContent, filename="registration.yaml") {
    const filePath = path.join(tempDir, filename);
    await fs.writeFile(filePath, JSON.stringify(content), "utf-8");
    return filePath;
}

async function writeConfigFile(content={}) {
    const filePath = path.join(tempDir, "config.yaml");
    await fs.writeFile(filePath, JSON.stringify(content), "utf-8");
    return filePath;
}

describe("Cli", () => {
    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "bridge-test"));
    });
    afterEach(async () => {
        await fs.rmdir(tempDir, {recursive: true});
    });

    it("should be able to start the bridge with just a registration file", async () => {
        let runCalledWith = false;
        const cli = new Cli({
            enableRegistration: false,
            registrationPath: await writeRegistrationFile({}, "reg.yml"),
            run: (...args) => { runCalledWith = args; }
        });
        cli.run();
        expect(runCalledWith[0]).toEqual(Cli.DEFAULT_PORT);
    });

    it("should be able to start the bridge with a custom port", async () => {
        const port = 1234;
        let runCalledWith = null;
        const cli = new Cli({
            enableRegistration: false,
            registrationPath: await writeRegistrationFile(),
            run: (...args) => { runCalledWith = args; }
        });
        cli.run({port});
        expect(runCalledWith[0]).toEqual(port);
    });

    it("should be able to start the bridge with a registration file and config file", async () => {
        const configData = {"a": "var", "b": true};
        const configFile = await writeConfigFile(configData);
        let runCalledWith = null;
        const cli = new Cli({
            enableRegistration: false,
            registrationPath: await writeRegistrationFile(),
            bridgeConfig: {},
            run: (...args) => { runCalledWith = args; }
        });
        cli.run({config: configFile});
        expect(runCalledWith[0]).toEqual(Cli.DEFAULT_PORT);
        expect(runCalledWith[1]).toEqual(configData);
        expect(runCalledWith[2].getOutput()).toEqual(registrationFileContent);
    });

    it("should reload config on SIGHUP", async () => {
        const newConfigData = {"b": "var", "c": false};
        const configFile = await writeConfigFile({"a": "var", "b": true});
        const configDefer = defer();
        const cli = new Cli({
            enableRegistration: false,
            registrationPath: await writeRegistrationFile(),
            bridgeConfig: { watchConfig: true, watchInterval: 100 },
            onConfigChanged: (config) => { configDefer.resolve(config); },
            run: (...args) => { }
        });
        cli.run({config: configFile});
        await writeConfigFile(newConfigData);
        // Send ourselves a signal
        process.kill(process.pid, "SIGHUP");
        expect(await configDefer.promise).toEqual(newConfigData);
    });
})
