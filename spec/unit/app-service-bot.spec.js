"use strict";
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
        client._http = jasmine.createSpyObj("MatrixHttpApi", ["authedRequest"]);
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
