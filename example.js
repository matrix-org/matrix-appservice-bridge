"use strict";
var AppServiceRegistration = require("matrix-appservice").AppServiceRegistration;
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
    // Required. the thing which will be called with run(port,config)
    bridge: bridgeInst,

    // Optional: where --generate-registration will dump to
    registrationPath: "my-bridge-registration.yaml",

    // Optional: default port, CLI can override with --port
    port: 8155,

    // Required if enableRegistration is true.
    // make the registration file. Callback provided so you can do DB hits.
    generateRegistration: function(callback) {
        var reg = new AppServiceRegistration("http://localhost:8008");
        reg.setHomeserverToken(AppServiceRegistration.generateToken());
        reg.setAppServiceToken(AppServiceRegistration.generateToken());
        reg.setSenderLocalpart("bridge-example");
        reg.addRegexPattern("users", "@example_.*", true);
        callback(reg);
    }
});

c.run(); // check system args
