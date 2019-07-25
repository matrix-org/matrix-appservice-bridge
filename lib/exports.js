"use strict";

module.exports.ClientFactory = require("./components/client-factory");
module.exports.Intent = require("./components/intent");
module.exports.AppServiceBot = require("./components/app-service-bot");
module.exports.StateLookup = require("./components/state-lookup");

// Config and CLI
module.exports.Cli = require("./components/cli");
module.exports.ConfigValidator = require("./components/config-validator");

// Requests
module.exports.Request = require("./components/request");
module.exports.RequestFactory = require("./components/request-factory");

// Store
module.exports.BridgeStore = require("./components/bridge-store");
module.exports.UserBridgeStore = require("./components/user-bridge-store");
module.exports.RoomBridgeStore = require("./components/room-bridge-store");
module.exports.EventBridgeStore = require("./components/event-bridge-store");

// Models
module.exports.MatrixUser = require("./models/users/matrix");
module.exports.RemoteUser = require("./models/users/remote");
module.exports.MatrixRoom = require("./models/rooms/matrix");
module.exports.RemoteRoom = require("./models/rooms/remote");
module.exports.StoredEvent = require("./models/events/event");

module.exports.Bridge = require("./bridge");
module.exports.AppServiceRegistration = (
    require("matrix-appservice").AppServiceRegistration
);
module.exports.ContentRepo = (
	require("matrix-js-sdk").ContentRepo
);

module.exports.PrometheusMetrics = require("./components/prometheusmetrics");
module.exports.PrometheusMetrics.AgeCounters = require("./components/agecounters");

// Caches
module.exports.MembershipCache = require("./components/membership-cache");

// Logging
module.exports.Logging = require("./components/logging");

// Consts for RoomLinkValidator
module.exports.RoomLinkValidatorStatus = require(
	"./components/room-link-validator"
).validationStatuses;

module.exports.unstable = { };

// Errors

module.exports.unstable.EventNotHandledError = require("./errors").EventNotHandledError;
module.exports.unstable.EventTooOldError = require("./errors").EventTooOldError;
module.exports.unstable.BridgeInternalError = require("./errors").BridgeInternalError;
module.exports.unstable.ForeignNetworkError = require("./errors").ForeignNetworkError;
module.exports.unstable.EventUnknownError = require("./errors").EventUnknownError;
module.exports.unstable.default_message = require("./errors").default_message;
