"use strict";
var AppServiceBot = require("../..").AppServiceBot;

describe("AppServiceBot", function() {
    var bot, client, reg;
    var botUserId = "@bot:bar";

    beforeEach(
    /** @this */
    function() {
        client = jasmine.createSpyObj("MatrixClient", ["credentials", "_http"]);
        client.credentials = {
            userId: botUserId
        };
        client.http = jasmine.createSpyObj("MatrixHttpApi", ["authedRequest"]);
        reg = jasmine.createSpyObj("AppServiceRegistration", ["getOutput"]);
        reg.getOutput.and.returnValue({
            namespaces: {
                users: [{
                    regex: "@test_.*",
                    exclusive: true
                }]
            }
        });
        bot = new AppServiceBot(client, botUserId, reg);
    });

    describe("getMemberLists", function() {
        it("should fail", function() {
            expect(() => { bot.getMemberLists(); }).toThrow();
        });
    });
});
