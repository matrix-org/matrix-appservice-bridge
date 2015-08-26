"use strict";

module.exports.ClientFactory = require("./components/client-factory");
module.exports.Intent = require("./components/intent");

// Requests
module.exports.Request = require("./components/request");
module.exports.RequestFactory = require("./components/request-factory");

// Store
module.exports.BridgeStore = require("./components/bridge-store");
module.exports.UserBridgeStore = require("./components/user-bridge-store");
module.exports.RoomBridgeStore = require("./components/room-bridge-store");

// Models
module.exports.MatrixUser = require("./models/users/matrix");
module.exports.RemoteUser = require("./models/users/remote");
module.exports.MatrixRoom = require("./models/rooms/matrix");
module.exports.RemoteRoom = require("./models/rooms/remote");
