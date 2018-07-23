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
        reg.getOutput.and.returnValue({
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
        it("should fail", function() {
            expect(() => { bot.getMemberLists(); }).toThrow();
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
