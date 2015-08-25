"use strict";

module.exports.ClientFactory = require("./components/client-factory");

// Requests
module.exports.Request = require("./components/request");
module.exports.RequestFactory = require("./components/request-factory");

// Store
module.exports.BridgeStore = require("./components/bridge-store");
module.exports.UserBridgeStore = require("./components/user-bridge-store");
module.exports.RoomBridgeStore = require("./components/room-bridge-store");

// Models
module.exports.MatrixUser = require("./models/users/matrix");
module.exports.JungleUser = require("./models/users/jungle");
module.exports.MatrixRoom = require("./models/rooms/matrix");
module.exports.JungleRoom = require("./models/rooms/jungle");
