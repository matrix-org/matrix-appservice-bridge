"use strict";
var AppServiceRegistration = require("matrix-appservice").AppServiceRegistration;
var bridgeLib = require("./");
var Cli = bridgeLib.Cli;
var Bridge = bridgeLib.Bridge;
var RemoteUser = bridgeLib.RemoteUser;

var bridgeInst = new Bridge({
    homeserverUrl: "http://localhost:8008",
    domain: "localhost",
    registration: "my-bridge-registration.yaml",
    userStore: "store-users.db",
    roomStore: "store-rooms.db",

    // optional function to automatically create users and set display names
    // and link to remote users in the store. Can also return a Promise here.
    provisionUser: function(matrixUserQueried) {
        var remoteUsername = matrixUserQueried.localpart.replace("example_", "");
        var remoteUser = new RemoteUser(remoteUsername);
        remoteUser.set("arbitrary key", {
            "arbitrary value": "here"
        });
        console.log(
            "provisionUser user_id=%s remote_id=%s",
            matrixUserQueried.getId(), remoteUser.getId()
        );
        return {
            name: remoteUsername,
            url: null,
            user: remoteUser
        };
    },

    provisionRoom: function(alias, aliasLocalpart) {
        return {
            creationOpts: {
                room_alias_name: aliasLocalpart,
                name: aliasLocalpart
            }
        };
    },

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
        console.log("Generating registration to 'my-bridge-registration.yaml'");
        callback(reg);
    }
});

c.run(); // check system args
