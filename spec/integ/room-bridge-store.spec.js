"use strict";
var Datastore = require("nedb");
var fs = require("fs");
var log = require("../log");
var Promise = require("bluebird");

var RoomBridgeStore = require("../..").RoomBridgeStore;
var MatrixRoom = require("../..").MatrixRoom;
var RemoteRoom = require("../..").RemoteRoom;
var TEST_DB_PATH = __dirname + "/test.db";

describe("RoomBridgeStore", function() {
    var store, db;

    beforeEach(
    /** @this */
    function(done) {
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
        try {
            fs.unlinkSync(TEST_DB_PATH);
        }
        catch (e) {
            // do nothing
        }
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

    describe("setRemoteRoom", function() {
        it("should be able to store a Remote room, retrievable again via getRemoteRoom",
        function(done) {
            var room = new RemoteRoom("some id");
            room.set("thing", "here");
            room.set("nested", {
                foo: "bar"
            });
            store.setRemoteRoom(room).then(function() {
                return store.getRemoteRoom("some id");
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
            var remoteRoom = new RemoteRoom("foo_bar");
            store.linkRooms(matrixRoom, remoteRoom).then(function() {
                return store.getMatrixRoom("!foo:bar");
            }).then(function(m) {
                expect(m.getId()).toEqual("!foo:bar");
                return store.getRemoteRoom("foo_bar");
            }).done(function(j) {
                expect(j.getId()).toEqual("foo_bar");
                done();
            });
        });

        it("should create a matrix room if they didn't exist previously",
        function(done) {
            var matrixRoom = new MatrixRoom("!foo:bar");
            var remoteRoom = new RemoteRoom("foo_bar");
            store.setRemoteRoom(remoteRoom).then(function() {
                return store.linkRooms(matrixRoom, remoteRoom);
            }).then(function() {
                return store.getMatrixRoom("!foo:bar");
            }).done(function(m) {
                expect(m.getId()).toEqual("!foo:bar");
                done();
            });
        });

        it("should create a remote room if they didn't exist previously",
        function(done) {
            var matrixRoom = new MatrixRoom("!foo:bar");
            var remoteRoom = new RemoteRoom("foo_bar");
            store.setMatrixRoom(matrixRoom).then(function() {
                return store.linkRooms(matrixRoom, remoteRoom);
            }).then(function() {
                return store.getRemoteRoom("foo_bar");
            }).done(function(j) {
                expect(j.getId()).toEqual("foo_bar");
                done();
            });
        });

        it("should not clobber rooms if they exist",
        function(done) {
            var matrixRoom = new MatrixRoom("!foo:bar");
            var storedRemoteRoom = new RemoteRoom("foo_bar");
            storedRemoteRoom.set("sentinel", 42);
            store.setRemoteRoom(storedRemoteRoom).then(function() {
                var newRemoteRoom = new RemoteRoom("foo_bar");
                return store.linkRooms(matrixRoom, newRemoteRoom);
            }).then(function() {
                return store.getRemoteRoom("foo_bar");
            }).done(function(j) {
                expect(j.getId()).toEqual("foo_bar");
                expect(j.get("sentinel")).toEqual(42);
                done();
            });
        });

        it("should support custom link keys", function(done) {
            var matrixRoom = new MatrixRoom("!foo:bar");
            var remoteRoom = new RemoteRoom("foo_bar");
            var linkKey = "flibble";
            var data = { foo: "bar" };
            store.linkRooms(matrixRoom, remoteRoom, data, linkKey).then(function() {
                return store.getLinksByKey(linkKey);
            }).done(function(links) {
                expect(links.length).toEqual(1);
                var link = links[0];
                expect(link.link_key).toEqual(linkKey);
                expect(link.matrix).toEqual(matrixRoom.getId());
                expect(link.remote).toEqual(remoteRoom.getId());
                expect(link.data).toEqual(data);
                done();
            });
        });
    });

    describe("unlinkByData", function() {
        it("should delete links which match the given data", function(done) {
            var matrixRoom = new MatrixRoom("!foo:bar");
            var remoteRoom = new RemoteRoom("#foo_bar");
            var data = { foo: "bar" };
            store.linkRooms(matrixRoom, remoteRoom, data).then(function() {
                return store.unlinkByData(data);
            }).done(function(deleteNum) {
                expect(deleteNum).toEqual(1);
                done();
            });
        });

        it("should delete links which partially match the given data", function(done) {
            var matrixRoom = new MatrixRoom("!foo:bar");
            var remoteRoom = new RemoteRoom("#foo_bar");
            var data = { foo: "bar", tar: 6 };
            store.linkRooms(matrixRoom, remoteRoom, data).then(function() {
                return store.unlinkByData({ foo: "bar" });
            }).done(function(deleteNum) {
                expect(deleteNum).toEqual(1);
                done();
            });
        });

        it("should NOT delete links which do not match the given data", function(done) {
            var matrixRoom = new MatrixRoom("!foo:bar");
            var remoteRoom = new RemoteRoom("#foo_bar");
            var data = { foo: "bar", tar: 6 };
            store.linkRooms(matrixRoom, remoteRoom, data).then(function() {
                return store.unlinkByData({ foo: "bar", tar: 99 });
            }).done(function(deleteNum) {
                expect(deleteNum).toEqual(0);
                done();
            });
        });

        it("should NOT delete links which have the same remote/matrix IDs",
        function(done) {
            var matrixRoom = new MatrixRoom("!foo:bar");
            var remoteRoom = new RemoteRoom("#foo_bar");
            var data = { foo: "bar" };
            var linkKey = "flibble";
            store.linkRooms(matrixRoom, remoteRoom, data).then(function() {
                return store.linkRooms(matrixRoom, remoteRoom, undefined, linkKey);
            }).then(function() {
                return store.unlinkByData(data);
            }).done(function(deleteNum) {
                expect(deleteNum).toEqual(1);
                done();
            });
        });
    });

    describe("unlinkRooms", function() {
        it("should delete a link made previously with linkRooms", function(done) {
            var matrixRoom = new MatrixRoom("!foo:bar");
            var remoteRoom = new RemoteRoom("foo_bar");
            store.linkRooms(matrixRoom, remoteRoom).then(function() {
                return store.unlinkRooms(matrixRoom, remoteRoom);
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
            var remoteRoom = new RemoteRoom("foo_bar");
            var data = {
                nested: {
                    key: "value"
                }
            };
            store.linkRooms(matrixRoom, remoteRoom, data).then(function() {
                return store.getLinksByData({
                    "nested.key": "value"
                });
            }).done(function(links) {
                expect(links.length).toEqual(1);
                expect(links[0].matrix).toEqual("!foo:bar");
                expect(links[0].remote).toEqual("foo_bar");
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
        var remoteRoom = new RemoteRoom("foo_bar");

        beforeEach(function(done) {
            store.linkRooms(matrixRoom, remoteRoom).done(function() {
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
                expect(links[0].remote).toEqual("foo_bar");
                expect(links[0].data).toEqual({});
                done();
            })
        });
        it("should return a list for multiple links", function(done) {
            var matrixTwo = new MatrixRoom("!baz:bar");
            store.linkRooms(matrixTwo, remoteRoom).then(function() {
                return store.getMatrixLinks("foo_bar");
            }).done(function(links) {
                expect(links.length).toEqual(2);
                done();
            });
        });
    });

    describe("getRemoteLinks", function() {
        var matrixRoom = new MatrixRoom("!foo:bar");
        var remoteRoom = new RemoteRoom("foo_bar");

        beforeEach(function(done) {
            store.linkRooms(matrixRoom, remoteRoom).done(function() {
                done();
            });
        });

        it("should return an empty list if there are no links", function(done) {
            store.getRemoteLinks("nothing").done(function(links) {
                expect(links.length).toEqual(0);
                done();
            });
        });
        it("should return a one element list for a single link", function(done) {
            store.getRemoteLinks("!foo:bar").done(function(links) {
                expect(links.length).toEqual(1);
                expect(links[0].matrix).toEqual("!foo:bar");
                expect(links[0].remote).toEqual("foo_bar");
                expect(links[0].data).toEqual({});
                done();
            })
        });
        it("should return a list for multiple links", function(done) {
            var remoteTwo = new RemoteRoom("foo_bar_2");
            store.linkRooms(matrixRoom, remoteTwo).then(function() {
                return store.getRemoteLinks("!foo:bar");
            }).done(function(links) {
                expect(links.length).toEqual(2);
                links.forEach(function(link) {
                    expect(["foo_bar", "foo_bar_2"].indexOf(
                        link.remote
                    )).not.toEqual(-1, "Bad remote ID returned");
                });
                done();
            });
        });
    });

    describe("batchGetRemoteLinks", function() {
        var entries = [
            { mx: new MatrixRoom("!foo:bar"), r: new RemoteRoom("#foo_bar") },
            // same remote mapping
            { mx: new MatrixRoom("!foo_bar:bar"), r: new RemoteRoom("#foo_bar") },
            { mx: new MatrixRoom("!fizz:buzz"), r: new RemoteRoom("#fizz_buzz") },
            { mx: new MatrixRoom("!alpha:beta"), r: new RemoteRoom("#alpha_beta") },
            // same matrix mapping
            { mx: new MatrixRoom("!alpha:beta"), r: new RemoteRoom("#alpha_bet") }
        ];
        var expectedOutput = {
            "!foo:bar": ["#foo_bar"],
            "!foo_bar:bar": ["#foo_bar"],
            "!fizz:buzz": ["#fizz_buzz"],
            "!alpha:beta": ["#alpha_beta", "#alpha_bet"]
        }

        // persist the links
        beforeEach(function(done) {
            Promise.all(entries.map(function(e) {
                return store.linkRooms(e.mx, e.r);
            })).done(function() {
                done();
            });
        });

        it("should return a map of links", function(done) {
            var mxIds = Object.keys(expectedOutput);
            store.batchGetRemoteLinks(mxIds).done(function(outputMap) {
                // make sure the keys are all there with the right links
                mxIds.forEach(function(roomId) {
                    var outputLinks = outputMap[roomId];
                    expect(outputLinks).toBeDefined();
                    if (!outputLinks) {
                        return;
                    }
                    expect(outputLinks.length).toEqual(expectedOutput[roomId].length);
                    var linkIds = outputLinks.map(function(l) {
                        return l.remote;
                    });
                    expect(linkIds.sort()).toEqual(expectedOutput[roomId].sort());
                });
                done();
            });
        });

        it("should return an empty list if there are no links", function(done) {
            store.batchGetRemoteLinks(["!nada:here", "!more:na"]).done(function(links) {
                expect(Object.keys(links).length).toEqual(0);
                done();
            });
        });
    });
});
