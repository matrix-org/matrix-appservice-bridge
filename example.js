"use strict";
var bridgeLib = require("./");
var Cli = bridgeLib.Cli;
var Bridge = bridgeLib.Bridge;

var bridgeInst = new Bridge({
    homeserverUrl: "http://localhost:8008",
    domain: "localhost",
    registration: "my-bridge-registration.yaml",
    controller: null // TODO: something relevant here?
});

var c = new Cli({
    bridge: bridgeInst, // the thing which will be called with run(port,config)
    registrationPath: "my-bridge-registration.yaml", // where gen reg will dump to
    port: 8155 // default port, CLI can override with --port
});

c.run(); // check system args
