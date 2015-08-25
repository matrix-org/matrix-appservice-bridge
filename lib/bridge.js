"use strict";

// Requests
module.exports.Request = require("./requests/request");
module.exports.RequestFactory = require("./requests/request-factory");

// Store
module.exports.BridgeStore = require("./store/bridge-store");
module.exports.UserBridgeStore = require("./store/user-bridge-store");
module.exports.RoomBridgeStore = require("./store/room-bridge-store");

// Models
module.exports.MatrixUser = require("./users/matrix");
module.exports.JungleUser = require("./users/jungle");
module.exports.MatrixRoom = require("./rooms/matrix");
module.exports.JungleRoom = require("./rooms/jungle");
