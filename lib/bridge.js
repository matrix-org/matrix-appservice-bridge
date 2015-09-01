"use strict";
/*
TODO Bridge:
- _onEvent -> Pluck out mapped users[] / rooms[] and invoke controller with intents.
              Need to preserve ordering of events / queuing. Provide options:
               * event_id (1 event at a time)
               * user_id (bucketed on user; +state_key for m.room.member)
               * room_id (bucketed on room)
               * none (don't preserve ordering / don't queue)
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
var MatrixUser = require("./models/users/matrix");
var MatrixRoom = require("./models/rooms/matrix");
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
 * @param {Function=} opts.logger The function to invoke when logging. Defaults
 * to a function which logs to the console.
 * @param {Bridge~provisionUser=} opts.provisionUser Optional. If supplied,
 * the bridge will automatically create users when queried via onUserQuery. If
 * not supplied, no users will be provisioned on user queries. Provisioned users
 * will automatically be stored in the associated <code>userStore</code>.
 * @param {Bridge~provisionRoom=} opts.provisionRoom Optional. If supplied,
 * the bridge will automatically create rooms when queried via onAliasQuery. If
 * not supplied, no rooms will be provisioned on alias queries. Provisioned rooms
 * will automatically be stored in the associated <code>roomStore</code>.
 * @param {boolean=} opts.suppressEcho True to stop receiving onEvent callbacks
 * for events which were sent by a bridge user. Default: true.
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

    // Load the registration file into an AppServiceRegistration object.
    if (typeof opts.registration === "string") {
        var regObj = yaml.safeLoad(fs.readFileSync(opts.registration, 'utf8'));
        opts.registration = AppServiceRegistration.fromObject(regObj);
        if (opts.registration === null) {
            throw new Error("Failed to parse registration file");
        }
    }
    // Default: logger -> log to console
    opts.logger = opts.logger || function(text, isError) {
        if (isError) {
            console.error(text);
            return;
        }
        console.log(text);
    };
    // Default: suppress echo -> True
    if (opts.suppressEcho === undefined) {
        opts.suppressEcho = true;
    }

    var self = this;
    this.appService = null;
    this.opts = opts;
    this._clientFactory = new ClientFactory({
        url: opts.registration.url,
        token: opts.registration.as_token,
        appServiceUserId: (
            "@" + opts.registration.sender_localpart + ":" + opts.domain
        )
    });
    this._clientFactory.setLogFunction(function(text, isErr) {
        if (!self.opts.logger) {
            return;
        }
        self.opts.logger(text, isErr);
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
    var self = this;
    this.appService = new AppService({
        homeserverToken: this.opts.registration.getHomeserverToken()
    });
    this.appService.onUserQuery = this._onUserQuery.bind(this);
    this.appService.onAliasQuery = this._onAliasQuery.bind(this);
    this.appService.on("event", this._onEvent.bind(this));
    this.appService.on("http-log", function(line) {
        if (!self.opts.logger) {
            return;
        }
        self.opts.logger(line, false);
    });
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
    var self = this;
    if (self.opts.provisionUser) {
        var matrixUser = new MatrixUser(userId);
        return Promise.resolve(
            self.opts.provisionUser(matrixUser)
        ).then(function(provisionedUser) {
            if (!provisionedUser) {
                throw new Error("Not provisioning user for this ID");
            }
            var promise = self._botClient.register(matrixUser.localpart);

            // storage promise chain
            promise.then(function() {
                var storePromise = self._userStore.setMatrixUser(matrixUser);
                if (provisionedUser.user) {
                    storePromise.then(function() {
                        return self._userStore.linkUsers(
                            matrixUser, provisionedUser.user
                        );
                    });
                }
                return storePromise;
            });

            // HTTP promise chain
            var newUser = self._clientFactory.getClientAs(userId);
            if (provisionedUser.name) {
                promise = promise.then(function() {
                    return newUser.setDisplayName(provisionedUser.name);
                });
            }
            if (provisionedUser.url) {
                promise = promise.then(function() {
                    return newUser.setAvatarUrl(provisionedUser.url);
                });
            }
            return promise;
        });
    }
    return Promise.resolve();
};

Bridge.prototype._onAliasQuery = function(alias) {
    var self = this;
    var remoteRoom = null;
    if (self.opts.provisionRoom) {
        return Promise.resolve(
            self.opts.provisionRoom(alias, alias.split(":")[0].substring(1))
        ).then(function(provisionedRoom) {
            if (!provisionedRoom) {
                throw new Error("Not provisioning room for this alias");
            }
            // do the HTTP hit
            remoteRoom = provisionedRoom.room;
            return self._botClient.createRoom(
                provisionedRoom.creationOpts
            );
        }).then(function(createRoomResponse) {
            // persist the mapping in the store
            var roomId = createRoomResponse.room_id;
            var matrixRoom = new MatrixRoom(roomId);
            if (remoteRoom) {
                return self._roomStore.linkRooms(matrixRoom, remoteRoom);
            }
            else {
                // store the matrix room only
                return self._roomStore.setMatrixRoom(matrixRoom);
            }
        });
    }
    return Promise.resolve();
};

Bridge.prototype._onEvent = function(event) {
    if (this.opts.suppressEcho &&
            this.opts.registration.isUserMatch(event.user_id, true)) {
        return Promise.resolve();
    }
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

/**
 * @typedef Bridge~ProvisionedUser
 * @type {Object}
 * @property {string=} name The display name to set for the provisioned user.
 * @property {string=} url The avatar URL to set for the provisioned user.
 * @property {RemoteUser=} user The remote user to link to the provisioned user.
 */

/**
 * @typedef Bridge~ProvisionedRoom
 * @type {Object}
 * @property {Object} creationOpts Room creation options to use when creating the
 * room. Required.
 * @property {RemoteRoom=} room The remote room to link to the provisioned room.
 */

/**
 * Invoked when the bridge receives a user query from the homeserver. Supports
 * both sync return values and async return values via promises.
 * @callback Bridge~provisionUser
 * @param {MatrixUser} matrixUser The matrix user queried. Use <code>getId()</code>
 * to get the user ID.
 * @return {?Bridge~ProvisionedUser|Promise<Bridge~ProvisionedUser, Error>}
 * Reject the promise / return null to not provision the user. Resolve the
 * promise / return a {@link Bridge~ProvisionedUser} object to provision the user.
 * @example
 * new Bridge({
 *   provisionUser: function(matrixUser) {
 *     var remoteUser = new RemoteUser("some_remote_id");
 *     return {
 *       name: matrixUser.localpart + " (Bridged)",
 *       url: "http://someurl.com/pic.jpg",
 *       user: remoteUser
 *     };
 *   }
 * });
 */

/**
 * Invoked when the bridge receives an alias query from the homeserver. Supports
 * both sync return values and async return values via promises.
 * @callback Bridge~provisionRoom
 * @param {string} alias The alias queried.
 * @param {string} aliasLocalpart The parsed localpart of the alias.
 * @return {?Bridge~ProvisionedRoom|Promise<Bridge~ProvisionedRoom, Error>}
 * Reject the promise / return null to not provision the room. Resolve the
 * promise / return a {@link Bridge~ProvisionedRoom} object to provision the room.
 * @example
 * new Bridge({
 *   provisionRoom: function(alias, aliasLocalpart) {
 *     return {
 *       creationOpts: {
 *         room_alias_name: aliasLocalpart,
 *         name: aliasLocalpart,
 *         topic: "Auto-generated bridged room"
 *       }
 *     };
 *   }
 * });
 */
