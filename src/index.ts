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

/* eslint-disable @typescript-eslint/no-var-requires */

module.exports.ClientFactory = require("./components/client-factory");
export * from "./components/intent";
module.exports.AppServiceBot = require("./components/app-service-bot");
module.exports.StateLookup = require("./components/state-lookup").StateLookup;

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
module.exports.BridgeContext = require("./components/bridge-context");
module.exports.AppServiceRegistration = (
    require("matrix-appservice").AppServiceRegistration
);

const jsSdk = require("matrix-js-sdk");

module.exports.ContentRepo = {
    getHttpUriForMxc: jsSdk.getHttpUriForMxc,
    getIdenticonUri: jsSdk.getIdenticonUri,
}

export * from "./components/prometheusmetrics";
module.exports.PrometheusMetrics.AgeCounters = require("./components/agecounters").AgeCounters;

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
