"use strict";

var UserBridgeStore = require("../..").UserBridgeStore;

describe("UserBridgeStore", function() {
    var store;

    beforeEach(function(done) {
        store = new UserBridgeStore();
        done();
    });

    describe("storeMatrixUser", function() {

        it("should be able to store a Matrix user, retrievable again via getByMatrixId",
        function() {

        });
    });

    describe("storeJungleUser", function() {

        it("should be able to store a Jungle user, retrievable again via getByJungleId",
        function() {

        });

        it("should fully persist all types of primitive data", function() {

        });

        it("should not persist functions", function() {

        });
    });

    describe("getByJungleData", function() {
        it("should be able to retrieve via top level keys", function() {

        });

        it("should be able to retrieve via nested keys", function() {

        });

        it("should be able to use basic NoSQL $commands", function() {

        });
    });

    describe("getMatrixUsersFromJungleId", function() {
        it("should return an empty array if there are no matches", function() {

        });

        it("should return a list of users for multiple matches", function() {

        });

        it("should return a single element list for a single match", function() {

        });
    });

    describe("getJungleUsersFromMatrixId", function() {
        it("should return an empty array if there are no matches", function() {

        });

        it("should return a list of users for multiple matches", function() {

        });

        it("should return a single element list for a single match", function() {

        });
    });
});