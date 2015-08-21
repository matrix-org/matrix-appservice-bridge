"use strict";
var Datastore = require("nedb");
var fs = require("fs");
var log = require("../log");

var RoomBridgeStore = require("../..").RoomBridgeStore;
var MatrixRoom = require("../..").MatrixRoom;
var JungleRoom = require("../..").JungleRoom;
var TEST_DB_PATH = __dirname + "/test.db";

describe("RoomBridgeStore", function() {
    var store, db;

    beforeEach(function(done) {
        log.beforeEach(this);
        db = new Datastore({
            filename: TEST_DB_PATH,
            autoload: true,
            onload: function(err) {
                if (err) {
                    console.error(err);
                    return;
                }
                store = new RoomBridgeStore(db);
                done();
            }
        });
    });

    afterEach(function() {
        fs.unlinkSync(TEST_DB_PATH);
    });

    describe("setMatrixRoom", function() {
        it("should be able to store a Matrix room, retrievable again via getMatrixRoom",
        function() {
        });
    });

    describe("setJungleRoom", function() {
        it("should be able to store a Jungle room, retrievable again via getJungleRoom",
        function() {
        });
    });

    describe("linkRooms", function() {
        it("should create a matrix user if they didn't exist previously",
        function() {

        });
        it("should create a jungle user if they didn't exist previously",
        function() {

        });
        it("should not clobber users if they exist",
        function() {

        });
    });

    describe("unlinkRooms", function() {
        it("should delete a link made previously with linkRooms", function() {

        });
        it("should no-op if there was no link", function() {

        });
    });

    describe("getLinksByData", function() {
        it("should be able to retrieve links based off nested data keys",
        function() {

        });
    });

    describe("getMatrixLinks", function() {
        it("should return an empty list if there are no links", function() {

        });
        it("should return a one element list for a single link", function() {

        });
        it("should return a list for multiple links", function() {

        });
    });

    describe("getJungleLinks", function() {
        it("should return an empty list if there are no links", function() {

        });
        it("should return a one element list for a single link", function() {

        });
        it("should return a list for multiple links", function() {

        });
    });
});
