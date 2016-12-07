"use strict";
var Promise = require("bluebird");
var AppServiceBot = require("../..").AppServiceBot;
var log = require("../log");

describe("AppServiceBot", function() {
    var bot, client, reg;
    var botUserId = "@bot:bar";

    beforeEach(
    /** @this */
    function() {
        log.beforeEach(this);
        client = jasmine.createSpyObj("MatrixClient", ["credentials", "_http"]);
        client.credentials = {
            userId: botUserId
        };
        client._http = jasmine.createSpyObj("MatrixHttpApi", ["authedRequestWithPrefix"]);
        reg = jasmine.createSpyObj("AppServiceRegistration", ["getOutput"]);
        reg.getOutput.andReturn({
            namespaces: {
                users: [{
                    regex: "@test_.*",
                    exclusive: true
                }]
            }
        });
        bot = new AppServiceBot(client, reg);
    });

    describe("getMemberLists", function() {

        it("should fail if the HTTP request fails", function(done) {
            client._http.authedRequestWithPrefix.andReturn(Promise.reject("nope"));
            bot.getMemberLists().catch(function(e) {
                done();
            });
        });

        it("should return joined members only from initial sync", function(done) {
            client._http.authedRequestWithPrefix.andReturn(Promise.resolve({
                rooms: {
                    join: {
                        "!foo:bar": {
                            state: {
                                events: [
                                memberEvent("!foo:bar", "@alice:bar", "join"),
                                memberEvent("!foo:bar", "@bob:bar", "invite"),
                                memberEvent("!foo:bar", "@charlie:bar", "leave")
                                ]
                            }
                        }
                    }
                }
            }));
            bot.getMemberLists().done(function(result) {
                expect(result["!foo:bar"].realJoinedUsers).toEqual([
                    "@alice:bar"
                ]);
                expect(Object.keys(result).length).toEqual(1);
                expect(result["!foo:bar"].remoteJoinedUsers.length).toEqual(0);
                done();
            });
        });

        it("should not return the bot itself as a remote user", function(done) {
            client._http.authedRequestWithPrefix.andReturn(Promise.resolve({
                rooms: {
                    join: {
                        "!foo:bar": {
                            state: {
                                events: [
                                memberEvent("!foo:bar", "@test_alice:bar", "join"),
                                memberEvent("!foo:bar", botUserId, "join")
                                ]
                            }
                        }
                    }
                }
            }));
            bot.getMemberLists().done(function(result) {
                expect(result["!foo:bar"].remoteJoinedUsers).toEqual([
                    "@test_alice:bar"
                ]);
                expect(Object.keys(result).length).toEqual(1);
                expect(result["!foo:bar"].realJoinedUsers.length).toEqual(0);
                done();
            });
        });

        it("should return remote users which match the registration regex",
        function(done) {
            client._http.authedRequestWithPrefix.andReturn(Promise.resolve({
                rooms: {
                    join: {
                        "!foo:bar": {
                            state: {
                                events: [
                                memberEvent("!foo:bar", "@test_alice:bar", "join"),
                                memberEvent("!foo:bar", "@alice:bar", "join")
                                ]
                            }
                        }
                    }
                }
            }));
            bot.getMemberLists().done(function(result) {
                expect(result["!foo:bar"].remoteJoinedUsers).toEqual([
                    "@test_alice:bar"
                ]);
                expect(result["!foo:bar"].realJoinedUsers).toEqual([
                    "@alice:bar"
                ]);
                expect(Object.keys(result).length).toEqual(1);
                done();
            });
        });
    });
});

function memberEvent(roomId, userId, state) {
    return {
        event_id: "something",
        type: "m.room.member",
        state_key: userId,
        room_id: roomId,
        user_id: userId,
        content: {
            membership: state
        }
    };
}
