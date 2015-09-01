"use strict";
/*
TODO Bridge:
- _onEvent -> Pluck out mapped users[] / rooms[] and invoke controller with intents.
              Need to preserve ordering of events / queuing. Provide options:
               * event_id (1 event at a time)
               * user_id (bucketed on user; +state_key for m.room.member)
               * room_id (bucketed on room)
               * none (don't preserve ordering / don't queue)
- _onUserQuery -> Add an AUTO_PROVISION function which allows display name and
                  avatar to be set when registering (also dumps in user store)
- _onAliasQuery -> Add an AUTO_PROVISION function which allows room creation opts
                   to be set per alias
- Add logging function (attach to http-log event on AppService and ClientFactory)
- Add a "suppress echo" flag which will prevent onEvent from firing when the
  sender is a user_id claimed by this AS. Default true.
- Context object: AppServiceBot (has a getClient method), Intent and Client
  instances


TODO example.js:
- Hook up controller to some callbacks.
*/
var AppServiceRegistration = require("matrix-appservice").AppServiceRegistration;
var AppService = require("matrix-appservice").AppService;
var ClientFactory = require("./components/client-factory");
var AppServiceBot = require("./components/app-service-bot");
var RequestFactory = require("./components/request-factory");
var Intent = require("./components/intent");
var RoomBridgeStore = require("./components/room-bridge-store");
var UserBridgeStore = require("./components/user-bridge-store");
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
 * @param {(RoomBridgeStore|string)=} opts.roomStore The room store instance to
 * use, or the path to the room .db file to load. A database will be created if
 * this is not specified.
 * @param {(UserBridgeStore|string)=} opts.userStore The user store instance to
 * use, or the path to the user .db file to load. A database will be created if
 * this is not specified.
 * @param {Object} opts.controller The controller logic for the bridge.
 * @param {Bridge~onEventCallback} opts.controller.onEvent Called when an event
 * has been received from the HS.
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
    this._clientFactory = new ClientFactory({
        url: opts.registration.url,
        token: opts.registration.as_token,
        appServiceUserId: (
            "@" + opts.registration.sender_localpart + ":" + opts.domain
        )
    });
    this._botClient = this._clientFactory.getClientAs();
    this._appServiceBot = new AppServiceBot(
        this._botClient, opts.registration
    );
    this._requestFactory = new RequestFactory();
    this._botIntent = new Intent(this._botClient, this._botClient);

    // TODO : string version
    this._roomStore = opts.roomStore || new RoomBridgeStore();
    this._userStore = opts.userStore || new UserBridgeStore();
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
    this.appService.on("event", this._onEvent);
    this.appService.listen(port);
};

/**
 * Retrieve a connected room store instance.
 * @return {RoomBridgeStore} The connected instance ready for querying.
 */
Bridge.prototype.getRoomStore = function() {
    return this._roomStore;
};

/**
 * Retrieve a connected user store instance.
 * @return {UserBridgeStore} The connected instance ready for querying.
 */
Bridge.prototype.getUserStore = function() {
    return this._userStore;
};

Bridge.prototype._onUserQuery = function(userId) {
    return Promise.resolve();
};

Bridge.prototype._onAliasQuery = function(alias) {
    return Promise.resolve();
};

Bridge.prototype._onEvent = function(event) {
    return Promise.resolve();
};

module.exports = Bridge;

/**
 * @typedef Bridge~BridgeContext
 * @type {Object}
 */

/**
 * Invoked when the bridge receives an event from the homeserver.
 * @callback Bridge~onEventCallback
 * @param {Request} request The request to resolve or reject depending on the
 * outcome of this request. The 'data' attached to this Request is the raw event
 * JSON received (accessed via <code>request.getData()</code>)
 * @param {Bridge~BridgeContext} context Context for this event, including
 * instantiated client instances.
 */
