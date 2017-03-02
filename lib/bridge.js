"use strict";

var AppServiceRegistration = require("matrix-appservice").AppServiceRegistration;
var AppService = require("matrix-appservice").AppService;
var ClientFactory = require("./components/client-factory");
var MatrixScheduler = require("matrix-js-sdk").MatrixScheduler;
var AppServiceBot = require("./components/app-service-bot");
var RequestFactory = require("./components/request-factory");
var Intent = require("./components/intent");
var RoomBridgeStore = require("./components/room-bridge-store");
var UserBridgeStore = require("./components/user-bridge-store");
var MatrixUser = require("./models/users/matrix");
var MatrixRoom = require("./models/rooms/matrix");
var PrometheusMetrics = require("./components/prometheusmetrics");
var fs = require("fs");
var yaml = require("js-yaml");
var Promise = require("bluebird");
var Datastore = require("nedb");
var util = require("util");

/**
 * @constructor
 * @param {Object} opts Options to pass to the bridge
 * @param {AppServiceRegistration|string} opts.registration Application service
 * registration object or path to the registration file.
 * @param {string} opts.homeserverUrl The base HS url
 * @param {string} opts.domain The domain part for user_ids and room aliases
 * e.g. "bar" in "@foo:bar".
 * @param {Object} opts.controller The controller logic for the bridge.
 * @param {Bridge~onEvent} opts.controller.onEvent Function. Called when
 * an event has been received from the HS.
 * @param {Bridge~onUserQuery=} opts.controller.onUserQuery Function. If supplied,
 * the bridge will invoke this function when queried via onUserQuery. If
 * not supplied, no users will be provisioned on user queries. Provisioned users
 * will automatically be stored in the associated <code>userStore</code>.
 * @param {Bridge~onAliasQuery=} opts.controller.onAliasQuery Function. If supplied,
 * the bridge will invoke this function when queried via onAliasQuery. If
 * not supplied, no rooms will be provisioned on alias queries. Provisioned rooms
 * will automatically be stored in the associated <code>roomStore</code>.
 * @param {Bridge~onAliasQueried=} opts.controller.onAliasQueried Function.
 * If supplied, the bridge will invoke this function when a room has been created
 * via onAliasQuery.
 * @param {Bridge~onLog=} opts.controller.onLog Function. Invoked when
 * logging. Defaults to a function which logs to the console.
 * @param {Bridge~thirdPartyLookup=} opts.controller.thirdPartyLookup Object. If
 * supplied, the bridge will respond to third-party entity lookups using the
 * contained helper functions.
 * @param {(RoomBridgeStore|string)=} opts.roomStore The room store instance to
 * use, or the path to the room .db file to load. A database will be created if
 * this is not specified.
 * @param {(UserBridgeStore|string)=} opts.userStore The user store instance to
 * use, or the path to the user .db file to load. A database will be created if
 * this is not specified.
 * @param {boolean=} opts.suppressEcho True to stop receiving onEvent callbacks
 * for events which were sent by a bridge user. Default: true.
 * @param {ClientFactory=} opts.clientFactory The client factory instance to
 * use. If not supplied, one will be created.
 * @param {boolean} opts.logRequestOutcome True to enable SUCCESS/FAILED log lines
 * to be sent to onLog. Default: true.
 * @param {Object=} opts.intentOptions Options to supply to created Intent instances.
 * @param {Object=} opts.intentOptions.bot Options to supply to the bot intent.
 * @param {Object=} opts.intentOptions.clients Options to supply to the client intents.
 * @param {Object=} opts.queue Options for the onEvent queue. When the bridge
 * receives an incoming transaction, it needs to asyncly query the data store for
 * contextual info before calling onEvent. A queue is used to keep the onEvent
 * calls consistent with the arrival order from the incoming transactions.
 * @param {string=} opts.queue.type The type of queue to use when feeding through
 * to {@link Bridge~onEvent}. One of: "none", single", "per_room". If "none",
 * events are fed through as soon as contextual info is obtained, which may result
 * in out of order events but stops HOL blocking. If "single", onEvent calls will
 * be in order but may be slower due to HOL blocking. If "per_room", a queue per
 * room ID is made which reduces the impact of HOL blocking to be scoped to a room.
 * Default: "single".
 * @param {boolean=} opts.queue.perRequest True to only feed through the next
 * event after the request object in the previous call succeeds or fails. It is
 * <b>vital</b> that you consistently resolve/reject the request if this is 'true',
 * else you will not get any further events from this queue. To aid debugging this,
 * consider setting a delayed listener on the request factory. If false, the mere
 * invockation of onEvent is enough to trigger the next event in the queue.
 * You probably want to set this to 'true' if your {@link Bridge~onEvent} is
 * performing async operations where ordering matters (e.g. messages). Default: false.
 * @param {boolean=} opts.disableContext True to disable {@link Bridge~BridgeContext}
 * parameters in {@link Bridge~onEvent}. Disabling the context makes the
 * bridge do fewer database lookups, but prevents there from being a
 * <code>context</code> parameter. Default: false.
 */
function Bridge(opts) {
    if (typeof opts !== "object") {
        throw new Error("opts must be supplied.");
    }
    var required = [
        "homeserverUrl", "registration", "domain", "controller"
    ];
    required.forEach(function(key) {
        if (!opts[key]) {
            throw new Error("Missing '" + key + "' in opts.");
        }
    });
    if (typeof opts.controller.onEvent !== "function") {
        throw new Error("controller.onEvent is a required function");
    }

    opts.userStore = opts.userStore || "user-store.db";
    opts.roomStore = opts.roomStore || "room-store.db";
    opts.queue = opts.queue || {};
    opts.intentOptions = opts.intentOptions || {};
    opts.queue.type = opts.queue.type || "single";
    if (opts.queue.perRequest === undefined) {
        opts.queue.perRequest = false;
    }
    if (opts.logRequestOutcome === undefined) {
        opts.logRequestOutcome = true;
    }

    // Default: logger -> log to console
    opts.controller.onLog = opts.controller.onLog || function(text, isError) {
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
    if (opts.disableContext === undefined) {
        opts.disableContext = false;
    }

    // we'll init these at runtime
    this.appService = null;
    this.opts = opts;
    this._clientFactory = null;
    this._botClient = null;
    this._appServiceBot = null;
    this._requestFactory = null;
    this._botIntent = null;
    this._intents = {
        // user_id + request_id : Intent
    };
    this._intents["bot"] = null;
    this._queue = new EventQueue(this.opts.queue, this._onConsume.bind(this));
    this._prevRequestPromise = Promise.resolve();
    this._metrics = null; // an optional PrometheusMetrics instance
}

/**
 * Load the user and room databases. Access them via getUserStore() and getRoomStore().
 * @return {Promise} Resolved/rejected when the user/room databases have been loaded.
 */
Bridge.prototype.loadDatabases = function() {
    var self = this;
    // Load up the databases if they provided file paths to them (or defaults)
    if (typeof self.opts.userStore === "string") {
        self.opts.userStore = loadDatabase(self.opts.userStore, UserBridgeStore);
    }
    if (typeof self.opts.roomStore === "string") {
        self.opts.roomStore = loadDatabase(self.opts.roomStore, RoomBridgeStore);
    }

    // This works because if they provided a string we converted it to a Promise
    // which will be resolved when we have the db instance. If they provided a
    // db instance then this will resolve immediately.
    return Promise.all([
        Promise.resolve(self.opts.userStore).then(function(db) {
            self._userStore = db;
        }),
        Promise.resolve(self.opts.roomStore).then(function(db) {
            self._roomStore = db;
        })
    ]);
};

/**
 * Run the bridge (start listening)
 * @param {Number} port The port to listen on.
 * @param {Object} config Configuration options
 * @param {AppService=} appServiceInstance The AppService instance to attach to.
 * If not provided, one will be created.
 */
Bridge.prototype.run = function(port, config, appServiceInstance) {
    var self = this;

    // Load the registration file into an AppServiceRegistration object.
    if (typeof self.opts.registration === "string") {
        var regObj = yaml.safeLoad(fs.readFileSync(self.opts.registration, 'utf8'));
        self.opts.registration = AppServiceRegistration.fromObject(regObj);
        if (self.opts.registration === null) {
            throw new Error("Failed to parse registration file");
        }
    }

    this._clientFactory = self.opts.clientFactory || new ClientFactory({
        url: self.opts.homeserverUrl,
        token: self.opts.registration.as_token,
        appServiceUserId: (
            "@" + self.opts.registration.sender_localpart + ":" + self.opts.domain
        ),
        clientSchedulerBuilder: function() {
            return new MatrixScheduler(retryAlgorithm, queueAlgorithm);
        },
    });
    this._clientFactory.setLogFunction(function(text, isErr) {
        if (!self.opts.controller.onLog) {
            return;
        }
        self.opts.controller.onLog(text, isErr);
    });
    this._botClient = this._clientFactory.getClientAs();
    this._appServiceBot = new AppServiceBot(
        this._botClient, self.opts.registration
    );
    this._requestFactory = new RequestFactory();
    if (this.opts.controller.onLog && this.opts.logRequestOutcome) {
        this._requestFactory.addDefaultResolveCallback(function(req, res) {
            self.opts.controller.onLog(
                "[" + req.getId() + "] SUCCESS (" + req.getDuration() + "ms)"
            );
        });
        this._requestFactory.addDefaultRejectCallback(function(req, err) {
            self.opts.controller.onLog(
                "[" + req.getId() + "] FAILED (" + req.getDuration() + "ms) " +
                (err ? util.inspect(err) : "")
            );
        });
    }
    var botIntentOpts = { registered: true };
    if (this.opts.intentOptions.bot) { // copy across opts
        Object.keys(this.opts.intentOptions.bot).forEach(function(k) {
            botIntentOpts[k] = self.opts.intentOptions.bot[k];
        });
    }
    this._botIntent = new Intent(this._botClient, this._botClient, botIntentOpts);
    this._intents = {
        // user_id + request_id : Intent
    };
    this._intents["bot"] = this._botIntent;

    this.appService = appServiceInstance || new AppService({
        homeserverToken: this.opts.registration.getHomeserverToken()
    });
    this.appService.onUserQuery = this._onUserQuery.bind(this);
    this.appService.onAliasQuery = this._onAliasQuery.bind(this);
    this.appService.on("event", this._onEvent.bind(this));
    this.appService.on("http-log", function(line) {
        if (!self.opts.controller.onLog) {
            return;
        }
        self.opts.controller.onLog(line, false);
    });
    this._customiseAppservice();

    if (this._metrics) {
        this._metrics.addAppServicePath(this);
    }

    this.appService.listen(port);
    return this.loadDatabases();
};

/**
 * Apply any customisations required on the appService object.
 */
Bridge.prototype._customiseAppservice = function() {
    if (this.opts.controller.thirdPartyLookup) {
        this._customiseAppserviceThirdPartyLookup(this.opts.controller.thirdPartyLookup);
    }
};

Bridge.prototype._customiseAppserviceThirdPartyLookup = function(lookupController) {
    var protocols = lookupController.protocols || [];

    var _respondErr = function(e, res) {
        if (typeof e === "object" && e.code && e.err) {
            res.status(e.code).json({error: e.err});
        }
        else {
            res.status(500).send("Failed: " + e);
        }
    }

    if (lookupController.getProtocol) {
        var getProtocolFunc = lookupController.getProtocol;

        this.addAppServicePath({
            method: "GET",
            path: "/_matrix/app/:ver/thirdparty/protocol/:protocol",
            handler: function(req, res) {
                if (req.params.ver !== "unstable") {
                    res.status(404).json(
                        {err: "Unrecognised API version " + req.params.ver}
                    );
                    return;
                }

                var protocol = req.params.protocol;

                if (protocols.length && protocols.indexOf(protocol) === -1) {
                    res.status(404).json({err: "Unknown 3PN protocol " + protocol});
                    return;
                }

                getProtocolFunc(protocol).then(
                    function(result) { res.status(200).json(result) },
                    function(e) { _respondErr(e, res) }
                );
            },
        });
    }

    if (lookupController.getLocation) {
        var getLocationFunc = lookupController.getLocation;

        this.addAppServicePath({
            method: "GET",
            path: "/_matrix/app/:ver/thirdparty/location/:protocol",
            handler: function(req, res) {
                if (req.params.ver !== "unstable") {
                    res.status(404).json(
                        {err: "Unrecognised API version " + req.params.ver}
                    );
                    return;
                }

                var protocol = req.params.protocol;

                if (protocols.length && protocols.indexOf(protocol) === -1) {
                    res.status(404).json({err: "Unknown 3PN protocol " + protocol});
                    return;
                }

                getLocationFunc(protocol, req.query).then(
                    function(result) { res.status(200).json(result) },
                    function(e) { _respondErr(e, res) }
                );
            },
        });
    }

    if (lookupController.parseLocation) {
        var parseLocationFunc = lookupController.parseLocation;

        this.addAppServicePath({
            method: "GET",
            path: "/_matrix/app/:ver/thirdparty/location",
            handler: function(req, res) {
                if (req.params.ver !== "unstable") {
                    res.status(404).json(
                        {err: "Unrecognised API version " + req.params.ver}
                    );
                    return;
                }

                var alias = req.query.alias;
                if (!alias) {
                    res.status(400).send({err: "Missing 'alias' parameter"});
                    return;
                }

                parseLocationFunc(alias).then(
                    function(result) { res.status(200).json(result) },
                    function(e) { _respondErr(e, res) }
                );
            },
        });
    }

    if (lookupController.getUser) {
        var getUserFunc = lookupController.getUser;

        this.addAppServicePath({
            method: "GET",
            path: "/_matrix/app/:ver/thirdparty/user/:protocol",
            handler: function(req, res) {
                if (req.params.ver !== "unstable") {
                    res.status(404).json(
                        {err: "Unrecognised API version " + req.params.ver}
                    );
                    return;
                }

                var protocol = req.params.protocol;

                if (protocols.length && protocols.indexOf(protocol) === -1) {
                    res.status(404).json({err: "Unknown 3PN protocol " + protocol});
                    return;
                }

                getUserFunc(protocol, req.query).then(
                    function(result) { res.status(200).json(result) },
                    function(e) { _respondErr(e, res) }
                );
            }
        });
    }

    if (lookupController.parseUser) {
        var parseUserFunc = lookupController.parseUser;

        this.addAppServicePath({
            method: "GET",
            path: "/_matrix/app/:ver/thirdparty/user",
            handler: function(req, res) {
                if (req.params.ver !== "unstable") {
                    res.status(404).json(
                        {err: "Unrecognised API version " + req.params.ver}
                    );
                    return;
                }

                var userid = req.query.userid;
                if (!userid) {
                    res.status(400).send({err: "Missing 'userid' parameter"});
                    return;
                }

                parseUserFunc(userid).then(
                    function(result) { res.status(200).json(result) },
                    function(e) { _respondErr(e, res) }
                );
            },
        });
    }
};

/**
 * Install a custom handler for an incoming HTTP API request. This allows
 * callers to add extra functionality, implement new APIs, etc...
 * @param {Object} opts Named options
 * @param {string} opts.method The HTTP method name.
 * @param {string} opts.path Path to the endpoint.
 * @param {Bridge~appServicePathHandler} opts.handler Function to handle requests
 * to this endpoint.
 */
Bridge.prototype.addAppServicePath = function(opts) {
    // TODO(paul): This is gut-wrenching into the AppService instance itself.
    //   Maybe an API on that object would be good?
    var app = this.appService.app;

    // TODO(paul): Consider more options:
    //   opts.versions - automatic version filtering and rejecting of
    //     unrecognised API versions
    // Consider automatic "/_matrix/app/:version" path prefix

    app[opts.method.toLowerCase()](opts.path, opts.handler);
};

/**
 * Retrieve a connected room store instance.
 * @return {?RoomBridgeStore} The connected instance ready for querying.
 */
Bridge.prototype.getRoomStore = function() {
    return this._roomStore;
};

/**
 * Retrieve a connected user store instance.
 * @return {?UserBridgeStore} The connected instance ready for querying.
 */
Bridge.prototype.getUserStore = function() {
    return this._userStore;
};

/**
 * Retrieve the request factory used to create incoming requests.
 * @return {RequestFactory}
 */
Bridge.prototype.getRequestFactory = function() {
    return this._requestFactory;
};

/**
 * Retrieve the matrix client factory used when sending matrix requests.
 * @return {ClientFactory}
 */
Bridge.prototype.getClientFactory = function() {
    return this._clientFactory;
};

/**
 * Get the AS bot instance.
 * @return {AppServiceBot}
 */
Bridge.prototype.getBot = function() {
    return this._appServiceBot;
};

/**
 * Retrieve an Intent instance for the specified user ID. If no ID is given, an
 * instance for the bot itself is returned.
 * @param {?string} userId The user ID to get an Intent for.
 * @param {Request=} request Optional. The request instance to tie the MatrixClient
 * instance to. Useful for logging contextual request IDs.
 * @return {Intent} The intent instance
 */
Bridge.prototype.getIntent = function(userId, request) {
    var self = this;
    if (!userId) {
        return this._botIntent;
    }
    var key = userId + (request ? request.getId() : "");
    if (!this._intents[key]) {
        var client = this._clientFactory.getClientAs(userId, request);
        var clientIntentOpts = {};
        if (this.opts.intentOptions.clients) {
            Object.keys(this.opts.intentOptions.clients).forEach(function(k) {
                clientIntentOpts[k] = self.opts.intentOptions.clients[k];
            });
        }
        this._intents[key] = new Intent(client, this._botClient, clientIntentOpts);
    }
    return this._intents[key];
};

/**
 * Retrieve an Intent instance for the specified user ID localpart. This <i>must
 * be the complete user localpart</i>.
 * @param {?string} localpart The user ID localpart to get an Intent for.
 * @param {Request=} request Optional. The request instance to tie the MatrixClient
 * instance to. Useful for logging contextual request IDs.
 * @return {Intent} The intent instance
 */
Bridge.prototype.getIntentFromLocalpart = function(localpart, request) {
    return this.getIntent(
        "@" + localpart + ":" + this.opts.domain
    );
};

/**
 * Provision a user on the homeserver.
 * @param {MatrixUser} matrixUser The virtual user to be provisioned.
 * @param {Bridge~ProvisionedUser} provisionedUser Provisioning information.
 * @return {Promise} Resolved when provisioned.
 */
Bridge.prototype.provisionUser = function(matrixUser, provisionedUser) {
    var self = this;
    var promise = self._botClient.register(matrixUser.localpart).then(function() {
        return self._userStore.setMatrixUser(matrixUser);
    });

    // storage promise chain
    if (provisionedUser.remote) {
        promise = promise.then(function() {
            return self._userStore.linkUsers(
                matrixUser, provisionedUser.remote
            );
        });
    }

    // HTTP promise chain
    var newUser = self._clientFactory.getClientAs(matrixUser.getId());
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
};

Bridge.prototype._onUserQuery = function(userId) {
    var self = this;
    if (self.opts.controller.onUserQuery) {
        var matrixUser = new MatrixUser(userId);
        return Promise.resolve(
            self.opts.controller.onUserQuery(matrixUser)
        ).then(function(provisionedUser) {
            if (!provisionedUser) {
                throw new Error("Not provisioning user for this ID");
            }
            return self.provisionUser(matrixUser, provisionedUser);
        });
    }
    return Promise.resolve();
};

Bridge.prototype._onAliasQuery = function(alias) {
    var self = this;
    var remoteRoom = null;
    var roomId;
    if (self.opts.controller.onAliasQuery) {
        return Promise.resolve(
            self.opts.controller.onAliasQuery(alias, alias.split(":")[0].substring(1))
        ).then(function(provisionedRoom) {
            if (!provisionedRoom) {
                throw new Error("Not provisioning room for this alias");
            }
            // do the HTTP hit
            remoteRoom = provisionedRoom.remote;
            return self._botClient.createRoom(
                provisionedRoom.creationOpts
            );
        }).then(function(createRoomResponse) {
            // persist the mapping in the store
            roomId = createRoomResponse.room_id;
            var matrixRoom = new MatrixRoom(roomId);
            if (remoteRoom) {
                return self._roomStore.linkRooms(matrixRoom, remoteRoom);
            }
            // store the matrix room only
            return self._roomStore.setMatrixRoom(matrixRoom);
        }).then(function() {
            if (self.opts.controller.onAliasQueried) {
                self.opts.controller.onAliasQueried(alias, roomId);
            }
        });
    }
    return Promise.resolve();
};

// returns a Promise for the request linked to this event for testing.
Bridge.prototype._onEvent = function(event) {
    this._updateIntents(event);
    if (this.opts.suppressEcho &&
            this.opts.registration.isUserMatch(event.user_id, true)) {
        return Promise.resolve();
    }

    var self = this;
    var request = this._requestFactory.newRequest({ data: event });
    var context = new BridgeContext({
        sender: event.user_id,
        target: event.state_key,
        room: event.room_id
    });
    var data = {
        request: request,
        context: context
    };

    var promise;
    if (this.opts.disableContext) {
        promise = Promise.resolve();
        data.context = null;
    }
    else {
        promise = context.get(this._roomStore, this._userStore);
    }

    if (this.opts.queue.type === "none") { // consume as soon as we have context
        promise.done(function() {
            self._onConsume(null, data);
        }, function(err) {
            self._onConsume(err);
        });
        return request.getPromise();
    }

    if (this.opts.queue.perRequest) {
        promise = Promise.settle([
            promise,
            this._prevRequestPromise
        ]);
        this._prevRequestPromise = request.getPromise();
    }

    this._queue.push(event, data, promise);
    this._queue.consume();
    return request.getPromise();
};

Bridge.prototype._onConsume = function(err, data) {
    if (!err) {
        this.opts.controller.onEvent(data.request, data.context);
        return;
    }
    if (!this.opts.controller.onLog) {
        return;
    }
    this.opts.controller.onLog(
        "onEvent failure: " + err
    );
};

Bridge.prototype._updateIntents = function(event) {
    var self = this;
    Object.keys(this._intents).forEach(function(key) {
        self._intents[key].onEvent(event);
    });
};

/**
 * Returns a PrometheusMetrics instance stored on the bridge, creating it first
 * if required. The instance will be registered with the HTTP server so it can
 * serve the "/metrics" page in the usual way.
 * The instance will automatically register the Matrix SDK metrics by calling
 * {PrometheusMetrics~registerMatrixSdkMetrics}.
 */
Bridge.prototype.getPrometheusMetrics = function() {
    if (this._metrics) {
        return this._metrics;
    }

    var metrics = this._metrics = new PrometheusMetrics();

    metrics.registerMatrixSdkMetrics();

    // TODO(paul): register some bridge-wide standard ones here

    // In case we're called after .run()
    if (this.appService) {
        metrics.addAppServicePath(this);
    }

    return metrics;
};

/**
 * A convenient shortcut to calling registerBridgeGauges() on the
 * PrometheusMetrics instance directly. This version will supply the value of
 * the matrixGhosts field if the counter function did not return it, for
 * convenience.
 * @param {PrometheusMetrics~BridgeGaugesCallback} counterFunc A function that
 * when invoked returns the current counts of various items in the bridge.
 *
 * @example
 * bridge.registerBridgeGauges(() => {
 *     return {
 *         matrixRoomConfigs: Object.keys(this.matrixRooms).length,
 *         remoteRoomConfigs: Object.keys(this.remoteRooms).length,
 *
 *         remoteGhosts: Object.keys(this.remoteGhosts).length,
 *
 *         ...
 *     }
 * })
 */
Bridge.prototype.registerBridgeGauges = function(counterFunc) {
    var self = this;

    this.getPrometheusMetrics().registerBridgeGauges(function() {
        var counts = counterFunc();

        if (!("matrixGhosts" in counts)) {
            // subtract 1 because of the bot intent
            counts.matrixGhosts = Object.keys(self._intents).length - 1;
        }

        return counts;
    });
};

module.exports = Bridge;

function loadDatabase(path, Cls) {
    var defer = Promise.defer();
    var db = new Datastore({
        filename: path,
        autoload: true,
        onload: function(err) {
            if (err) {
                defer.reject(err);
            }
            else {
                defer.resolve(new Cls(db));
            }
        }
    });
    return defer.promise;
}

function retryAlgorithm(event, attempts, err) {
    if (err.httpStatus === 400 || err.httpStatus === 403 || err.httpStatus === 401) {
        // client error; no amount of retrying with save you now.
        return -1;
    }
    // we ship with browser-request which returns { cors: rejected } when trying
    // with no connection, so if we match that, give up since they have no conn.
    if (err.cors === "rejected") {
        return -1;
    }

    if (err.name === "M_LIMIT_EXCEEDED") {
        var waitTime = err.data.retry_after_ms;
        if (waitTime) {
            return waitTime;
        }
    }
    if (attempts > 4) {
        return -1; // give up
    }
    return 1000 + (1000 * attempts);
}

function queueAlgorithm(event) {
    if (event.getType() === "m.room.message") {
        // use a separate queue for each room ID
        return "message_" + event.getRoomId();
    }
    // allow all other events continue concurrently.
    return null;
}

function EventQueue(opts, consumeFn) {
    this.type = opts.type;
    this._queues = {
        // $identifier: {
        //  events: [ {data: promise: } ],
        //  consuming: true|false
        // }
    };
    this.consumeFn = consumeFn;
}

EventQueue.prototype.push = function(event, data, promise) {
    var identifier = this.type === "per_room" ? event.room_id : "none";
    if (!this._queues[identifier]) {
        this._queues[identifier] = {
            events: [],
            consuming: false
        };
    }
    this._queues[identifier].events.push({
        data: data,
        promise: promise
    });
};

EventQueue.prototype.consume = function() {
    var self = this;
    Object.keys(this._queues).forEach(function(identifier) {
        if (!self._queues[identifier].consuming) {
            self._queues[identifier].consuming = true;
            self._takeNext(identifier);
        }
    });
};

EventQueue.prototype._takeNext = function(identifier) {
    var self = this;
    var events = this._queues[identifier].events;
    if (events.length === 0) {
        this._queues[identifier].consuming = false;
        return;
    }
    var entry = events.shift();
    entry.promise.done(function() {
        self.consumeFn(null, entry.data);
        self._takeNext(identifier);
    }, function(e) {
        self.consumeFn(e, null);
        self._takeNext(identifier);
    });
};

function BridgeContext(ctx) {
    this._ctx = ctx;
    this.senders = {
        matrix: new MatrixUser(ctx.sender),
        remote: null,
        remotes: []
    };
    this.targets = {
        matrix: ctx.target ? new MatrixUser(ctx.target) : null,
        remote: null,
        remotes: []
    };
    this.rooms = {
        matrix: new MatrixRoom(ctx.room),
        remote: null,
        remotes: []
    };
}

BridgeContext.prototype.get = function(roomStore, userStore) {
    var self = this;
    return Promise.try(function() {
        return [
            roomStore.getLinkedRemoteRooms(self._ctx.room),
            userStore.getRemoteUsersFromMatrixId(self._ctx.sender),
            (self._ctx.target ?
                userStore.getRemoteUsersFromMatrixId(self._ctx.target) :
                Promise.resolve([])),
            roomStore.getMatrixRoom(self._ctx.room),
            userStore.getMatrixUser(self._ctx.sender)
        ];
    }).spread(function(remoteRooms, remoteSenders, remoteTargets, mxRoom, mxSender) {
        if (remoteRooms && remoteRooms.length > 0) {
            self.rooms.remotes = remoteRooms;
            self.rooms.remote = remoteRooms[0];
        }
        if (remoteSenders && remoteSenders.length > 0) {
            self.senders.remotes = remoteSenders;
            self.senders.remote = remoteSenders[0];
        }
        if (remoteTargets && remoteTargets.length > 0) {
            self.targets.remotes = remoteTargets;
            self.targets.remote = remoteTargets[0];
        }
        if (mxRoom) {
            self.rooms.matrix = mxRoom;
        }
        if (mxSender) {
            self.senders.matrix = mxSender;
        }
    });
};

/**
 * @typedef Bridge~BridgeContext
 * @type {Object}
 * @property {Object} senders Data models on senders of this event
 * @property {MatrixUser} senders.matrix The sender of this event
 * @property {?RemoteUser} senders.remote The first linked remote sender: remotes[0]
 * @property {RemoteUser[]} senders.remotes The linked remote senders
 * @property {Object} targets Data models on targets (e.g. state_key in
 * m.room.member) of this event.
 * @property {?MatrixUser} targets.matrix The target of this event if applicable.
 * @property {?RemoteUser} targets.remote The first linked remote target: remotes[0]
 * @property {RemoteUser[]} targets.remotes The linked remote targets
 * @property {Object} rooms Data models on rooms concerning this event.
 * @property {MatrixRoom} rooms.matrix The room for this event.
 * @property {?RemoteRoom} rooms.remote The first linked remote room: remotes[0]
 * @property {RemoteRoom[]} rooms.remotes The linked remote rooms for this event
 */

/**
 * @typedef Bridge~ProvisionedUser
 * @type {Object}
 * @property {string=} name The display name to set for the provisioned user.
 * @property {string=} url The avatar URL to set for the provisioned user.
 * @property {RemoteUser=} remote The remote user to link to the provisioned user.
 */

/**
 * @typedef Bridge~ProvisionedRoom
 * @type {Object}
 * @property {Object} creationOpts Room creation options to use when creating the
 * room. Required.
 * @property {RemoteRoom=} remote The remote room to link to the provisioned room.
 */

/**
 * Invoked when the bridge receives a user query from the homeserver. Supports
 * both sync return values and async return values via promises.
 * @callback Bridge~onUserQuery
 * @param {MatrixUser} matrixUser The matrix user queried. Use <code>getId()</code>
 * to get the user ID.
 * @return {?Bridge~ProvisionedUser|Promise<Bridge~ProvisionedUser, Error>}
 * Reject the promise / return null to not provision the user. Resolve the
 * promise / return a {@link Bridge~ProvisionedUser} object to provision the user.
 * @example
 * new Bridge({
 *   controller: {
 *     onUserQuery: function(matrixUser) {
 *       var remoteUser = new RemoteUser("some_remote_id");
 *       return {
 *         name: matrixUser.localpart + " (Bridged)",
 *         url: "http://someurl.com/pic.jpg",
 *         user: remoteUser
 *       };
 *     }
 *   }
 * });
 */

/**
 * Invoked when the bridge receives an alias query from the homeserver. Supports
 * both sync return values and async return values via promises.
 * @callback Bridge~onAliasQuery
 * @param {string} alias The alias queried.
 * @param {string} aliasLocalpart The parsed localpart of the alias.
 * @return {?Bridge~ProvisionedRoom|Promise<Bridge~ProvisionedRoom, Error>}
 * Reject the promise / return null to not provision the room. Resolve the
 * promise / return a {@link Bridge~ProvisionedRoom} object to provision the room.
 * @example
 * new Bridge({
 *   controller: {
 *     onAliasQuery: function(alias, aliasLocalpart) {
 *       return {
 *         creationOpts: {
 *           room_alias_name: aliasLocalpart, // IMPORTANT: must be set to make the link
 *           name: aliasLocalpart,
 *           topic: "Auto-generated bridged room"
 *         }
 *       };
 *     }
 *   }
 * });
 */

 /**
  * Invoked when a response is returned from onAliasQuery. Supports
  * both sync return values and async return values via promises.
  * @callback Bridge~onAliasQueried
  * @param {string} alias The alias queried.
  * @param {string} roomId The parsed localpart of the alias.
  */

 /**
 * Invoked when the bridge receives an event from the homeserver.
 * @callback Bridge~onEvent
 * @param {Request} request The request to resolve or reject depending on the
 * outcome of this request. The 'data' attached to this Request is the raw event
 * JSON received (accessed via <code>request.getData()</code>)
 * @param {Bridge~BridgeContext} context Context for this event, including
 * instantiated client instances.
 */

 /**
 * Invoked when the bridge is attempting to log something.
 * @callback Bridge~onLog
 * @param {string} line The text to be logged.
 * @param {boolean} isError True if this line should be treated as an error msg.
 */

 /**
  * Handler function for custom applied HTTP API request paths. This is invoked
  * as defined by expressjs.
  * @callback Bridge~appServicePathHandler
  * @param {Request} req An expressjs Request object the handler can use to
  * inspect the incoming request.
  * @param {Response} res An expressjs Response object the handler can use to
  * send the outgoing response.
  */

 /**
  * @typedef Bridge~thirdPartyLookup
  * @type {Object}
  * @property {string[]} protocols Optional list of recognised protocol names.
  * If present, lookups for unrecognised protocols will be automatically
  * rejected.
  * @property {Bridge~getProtocol} getProtocol Function. Called for requests
  * for 3PE query metadata.
  * @property {Bridge~getLocation} getLocation Function. Called for requests
  * for 3PLs.
  * @property {Bridge~parseLocation} parseLocation Function. Called for reverse
  * parse requests on 3PL aliases.
  * @property {Bridge~getUser} getUser Function. Called for requests for 3PUs.
  * @property {Bridge~parseUser} parseUser Function. Called for reverse parse
  * requests on 3PU user IDs.
  */

 /**
  * Invoked on requests for 3PE query metadata
  * @callback Bridge~getProtocol
  * @param {string} protocol The name of the 3PE protocol to query
  * @return {Promise<Bridge~thirdPartyProtocolResult>} A Promise of metadata
  * about 3PE queries that can be made for this protocol.
  */

 /**
  * Returned by getProtocol third-party query metadata requests
  * @typedef Bridge~thirdPartyProtocolResult
  * @type {Object}
  * @property {string[]} [location_fields] Names of the fields required for
  * location lookups if location queries are supported.
  * @property {string[]} [user_fields] Names of the fields required for user
  * lookups if user queries are supported.

 /**
  * Invoked on requests for 3PLs
  * @callback Bridge~getLocation
  * @param {string} protocol The name of the 3PE protocol
  * @param {Object} fields The location query field data as specified by the
  * specific protocol.
  * @return {Promise<Bridge~thirdPartyLocationResult[]>} A Promise of a list of
  * 3PL lookup results.
  */

 /**
  * Invoked on requests to parse 3PL aliases
  * @callback Bridge~parseLocation
  * @param {string} alias The room alias to parse.
  * @return {Promise<Bridge~thirdPartyLocationResult[]>} A Promise of a list of
  * 3PL lookup results.
  */

 /**
  * Returned by getLocation and parseLocation third-party location lookups
  * @typedef Bridge~thirdPartyLocationResult
  * @type {Object}
  * @property {string} alias The Matrix room alias to the portal room
  * representing this 3PL
  * @property {string} protocol The name of the 3PE protocol
  * @property {object} fields The normalised values of the location query field
  * data.
  */

 /**
  * Invoked on requests for 3PUs
  * @callback Bridge~getUser
  * @param {string} protocol The name of the 3PE protocol
  * @param {Object} fields The user query field data as specified by the
  * specific protocol.
  * @return {Promise<Bridge~thirdPartyUserResult[]>} A Promise of a list of 3PU
  * lookup results.
  */

 /**
  * Invoked on requests to parse 3PU user IDs
  * @callback Bridge~parseUser
  * @param {string} userid The user ID to parse.
  * @return {Promise<Bridge~thirdPartyUserResult[]>} A Promise of a list of 3PU
  * lookup results.
  */

 /**
  * Returned by getUser and parseUser third-party user lookups
  * @typedef Bridge~thirdPartyUserResult
  * @type {Object}
  * @property {string} userid The Matrix user ID for the ghost representing
  * this 3PU
  * @property {string} protocol The name of the 3PE protocol
  * @property {object} fields The normalised values of the user query field
  * data.
  */
