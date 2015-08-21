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
        function(done) {
            var room = new MatrixRoom("!foo:bar");
            store.setMatrixRoom(room).then(function() {
                return store.getMatrixRoom("!foo:bar");
            }).done(function(r) {
                expect(r.getId()).toEqual("!foo:bar");
                done();
            });
        });
    });

    describe("setJungleRoom", function() {
        it("should be able to store a Jungle room, retrievable again via getJungleRoom",
        function(done) {
            var room = new JungleRoom("some id");
            room.set("thing", "here");
            room.set("nested", {
                foo: "bar"
            });
            store.setJungleRoom(room).then(function() {
                return store.getJungleRoom("some id");
            }).done(function(r) {
                expect(r.getId()).toEqual("some id");
                expect(r.get("thing")).toEqual("here");
                expect(r.get("nested")).toEqual({
                    foo: "bar"
                });
                done();
            });
        });
    });

    describe("linkRooms", function() {
        it("should create both rooms if they didn't exist previously",
        function(done) {
            var matrixRoom = new MatrixRoom("!foo:bar");
            var jungleRoom = new JungleRoom("foo_bar");
            store.linkRooms(matrixRoom, jungleRoom).then(function() {
                return store.getMatrixRoom("!foo:bar");
            }).then(function(m) {
                expect(m.getId()).toEqual("!foo:bar");
                return store.getJungleRoom("foo_bar");
            }).done(function(j) {
                expect(j.getId()).toEqual("foo_bar");
                done();
            });
        });

        it("should create a matrix room if they didn't exist previously",
        function(done) {
            var matrixRoom = new MatrixRoom("!foo:bar");
            var jungleRoom = new JungleRoom("foo_bar");
            store.setJungleRoom(jungleRoom).then(function() {
                return store.linkRooms(matrixRoom, jungleRoom);
            }).then(function() {
                return store.getMatrixRoom("!foo:bar");
            }).done(function(m) {
                expect(m.getId()).toEqual("!foo:bar");
                done();
            });
        });

        it("should create a jungle room if they didn't exist previously",
        function(done) {
            var matrixRoom = new MatrixRoom("!foo:bar");
            var jungleRoom = new JungleRoom("foo_bar");
            store.setMatrixRoom(matrixRoom).then(function() {
                return store.linkRooms(matrixRoom, jungleRoom);
            }).then(function() {
                return store.getJungleRoom("foo_bar");
            }).done(function(j) {
                expect(j.getId()).toEqual("foo_bar");
                done();
            });
        });

        it("should not clobber rooms if they exist",
        function(done) {
            var matrixRoom = new MatrixRoom("!foo:bar");
            var storedJungleRoom = new JungleRoom("foo_bar");
            storedJungleRoom.set("sentinel", 42);
            store.setJungleRoom(storedJungleRoom).then(function() {
                var newJungleRoom = new JungleRoom("foo_bar");
                return store.linkRooms(matrixRoom, newJungleRoom);
            }).then(function() {
                return store.getJungleRoom("foo_bar");
            }).done(function(j) {
                expect(j.getId()).toEqual("foo_bar");
                expect(j.get("sentinel")).toEqual(42);
                done();
            });
        });
    });

    describe("unlinkRooms", function() {
        it("should delete a link made previously with linkRooms", function(done) {
            var matrixRoom = new MatrixRoom("!foo:bar");
            var jungleRoom = new JungleRoom("foo_bar");
            store.linkRooms(matrixRoom, jungleRoom).then(function() {
                return store.unlinkRooms(matrixRoom, jungleRoom);
            }).then(function() {
                return store.getMatrixLinks("foo_bar");
            }).done(function(links) {
                expect(links.length).toEqual(0);
                done();
            });
        });
    });

    describe("getLinksByData", function() {
        it("should be able to retrieve links based off nested data keys",
        function(done) {
            var matrixRoom = new MatrixRoom("!foo:bar");
            var jungleRoom = new JungleRoom("foo_bar");
            var data = {
                nested: {
                    key: "value"
                }
            };
            store.linkRooms(matrixRoom, jungleRoom, data).then(function() {
                return store.getLinksByData({
                    "nested.key": "value"
                });
            }).done(function(links) {
                expect(links.length).toEqual(1);
                expect(links[0].matrix).toEqual("!foo:bar");
                expect(links[0].jungle).toEqual("foo_bar");
                expect(links[0].data).toEqual(data);
                done();
            });
        });

        it("should throw if the data query isn't an object", function() {
            expect(function() {
                store.getLinksByData("nested.key");
            }).toThrow();
        });
    });

    describe("getMatrixLinks", function() {
        var matrixRoom = new MatrixRoom("!foo:bar");
        var jungleRoom = new JungleRoom("foo_bar");

        beforeEach(function(done) {
            store.linkRooms(matrixRoom, jungleRoom).done(function() {
                done();
            });
        });

        it("should return an empty list if there are no links", function(done) {
            store.getMatrixLinks("nothing").done(function(links) {
                expect(links.length).toEqual(0);
                done();
            });
        });
        it("should return a one element list for a single link", function(done) {
            store.getMatrixLinks("foo_bar").done(function(links) {
                expect(links.length).toEqual(1);
                expect(links[0].matrix).toEqual("!foo:bar");
                expect(links[0].jungle).toEqual("foo_bar");
                expect(links[0].data).toEqual({});
                done();
            })
        });
        it("should return a list for multiple links", function(done) {
            var matrixTwo = new MatrixRoom("!baz:bar");
            store.linkRooms(matrixTwo, jungleRoom).then(function() {
                return store.getMatrixLinks("foo_bar");
            }).done(function(links) {
                expect(links.length).toEqual(2);
                done();
            });
        });
    });

    describe("getJungleLinks", function() {
        var matrixRoom = new MatrixRoom("!foo:bar");
        var jungleRoom = new JungleRoom("foo_bar");

        beforeEach(function(done) {
            store.linkRooms(matrixRoom, jungleRoom).done(function() {
                done();
            });
        });

        it("should return an empty list if there are no links", function(done) {
            store.getJungleLinks("nothing").done(function(links) {
                expect(links.length).toEqual(0);
                done();
            });
        });
        it("should return a one element list for a single link", function(done) {
            store.getJungleLinks("!foo:bar").done(function(links) {
                expect(links.length).toEqual(1);
                expect(links[0].matrix).toEqual("!foo:bar");
                expect(links[0].jungle).toEqual("foo_bar");
                expect(links[0].data).toEqual({});
                done();
            })
        });
        it("should return a list for multiple links", function(done) {
            var jungleTwo = new JungleRoom("foo_bar_2");
            store.linkRooms(matrixRoom, jungleTwo).then(function() {
                return store.getJungleLinks("!foo:bar");
            }).done(function(links) {
                expect(links.length).toEqual(2);
                links.forEach(function(link) {
                    expect(["foo_bar", "foo_bar_2"].indexOf(
                        link.jungle
                    )).not.toEqual(-1, "Bad jungle ID returned");
                });
                done();
            });
        });
    });
});
