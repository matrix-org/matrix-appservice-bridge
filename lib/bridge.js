"use strict";
/*
TODO Bridge:
- Construct ClientFactory to make an AppServiceBot and set as props
- Construct a RequestFactory to make Requests on callbacks
- Construct an Intent and hook to AS bot Client.
- Hook AppService on event and pass to Intent before passing up to callbacks
- Think of what callbacks to expose.

TODO example.js:
- Hook up controller to some callbacks.
*/
var AppServiceRegistration = require("matrix-appservice").AppServiceRegistration;
var AppService = require("matrix-appservice").AppService;
var fs = require("fs");
var yaml = require("js-yaml");
var Promise = require("bluebird");

/**
 * @constructor
 * @param {Object} opts Options to pass to the bridge
 * @param {AppServiceRegistration|string} opts.registration Application service
 * registration object or path to the registration file.
 * @param {string} opts.homeserverUrl The base HS url
 * @param {string} opts.domain The domain part for user_ids and room aliases
 * e.g. "bar" in "@foo:bar".
 */
function Bridge(opts) {
    if (typeof opts !== "object") {
        throw new Error("opts must be supplied.");
    }
    var required = [
        "homeserverUrl", "registration", "domain"
    ];
    required.forEach(function(key) {
        if (!opts[key]) {
            throw new Error("Missing '" + key + "' in opts.");
        }
    });
    if (typeof opts.registration === "string") {
        // load the registration file into an AppServiceRegistration object.
        var regObj = yaml.safeLoad(fs.readFileSync(opts.registration, 'utf8'));
        opts.registration = new AppServiceRegistration(regObj.url);
        opts.registration.setHomeserverToken(regObj.hs_token);
        opts.registration.setAppServiceToken(regObj.as_token);
        opts.registration.setSenderLocalpart(regObj.sender_localpart);
        if (regObj.namespaces) {
            var kinds = ["users", "aliases", "rooms"];
            kinds.forEach(function(kind) {
                if (!regObj.namespaces[kind]) {
                    return;
                }
                regObj.namespaces[kind].forEach(function(regexObj) {
                    opts.registration.addRegexPattern(
                        kind, regexObj.regex, regexObj.exclusive
                    );
                });
            });
        }

    }
    this.appService = null;
    this.opts = opts;
}

/**
 * Run the bridge (start listening)
 * @param {Number} port The port to listen on.
 * @param {Object} config Configuration options
 */
Bridge.prototype.run = function(port, config) {
    // listen on AS port
    // invoke onRun on remote side
    console.log("Bridge.run port=%s config=%s", port, config);
    this.appService = new AppService({
        homeserverToken: this.opts.registration.getHomeserverToken()
    });
    this.appService.onUserQuery = this._onUserQuery;
    this.appService.onAliasQuery = this._onAliasQuery;
    this.appService.listen(port);
};

Bridge.prototype._onUserQuery = function(userId) {
    return Promise.resolve();
};

Bridge.prototype._onAliasQuery = function(alias) {
    return Promise.resolve();
};

/*
NOTES:

Two flows to consider:
 - Incoming remote events to outgoing matrix events
 - Incoming matrix events to outgoing remote events

Four API designs involved:
 - Asking the remote side to send an event
 - Asking the matrix side to send an event [Intent class]
 - Notification of new remote events
 - Notification of new matrix events [onAliasQuery, onEvent]

How much should we wrest control of the remote side from the developer? This
would mean forcing the dev to write a class meeting some interface which the
Bridge class can use to glue everything together. This interface needs to
specify the remaining 2 API designs. The interface needs to be able to map
arbitrary data to matrix data (rooms, users, etc).

Provide two modes of operation? One saying "hey meet this interface and we'll do
it all for you", the other being "here's the onXXX and Intent class, have fun!".

Interface operation:
  {
    onIncomingremoteEvent: function(event) {} <--they implement these functions?
    sendremoteEvent: function(event) {} <-----------`
  }

Main problem is that we need to know how to map from their IDs to matrix IDs and
know the capabilities of the network (e.g. do they understand invites?).

Make them implement their own "Intent" class? This will dissolve into just:
  onInvite(function(event) {
    var mapped = map(event);
    intent.invite(mapped);
  }
Perhaps with virtual user suppression included for free.

*/

module.exports = Bridge;
