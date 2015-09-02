"use strict";
describe("Bridge", function() {
    // var bridge, appService;

    beforeEach(function() {

    });

    describe("onUserQuery", function() {
        it("should invoke the user-supplied onUserQuery function with the right args",
        function() {

        });

        it("should not provision a user if null is returned from the function",
        function() {

        });

        it("should provision the user from the return object", function() {

        });

        it("should store the new matrix user", function() {

        });

        it("should store and link the new matrix user if a remote user was supplied",
        function() {

        });
    });

    describe("onAliasQuery", function() {
        it("should invoke the user-supplied onAliasQuery function with the right args",
        function() {

        });

        it("should not provision a room if null is returned from the function",
        function() {

        });

        it("should provision the room from the return object", function() {

        });

        it("should store the new matrix room", function() {

        });

        it("should store and link the new matrix room if a remote room was supplied",
        function() {

        });
    });

    describe("onEvent", function() {
        it("should suppress the event if it is an echo and suppressEcho=true",
        function() {

        });

        it("should invoke the user-supplied onEvent function with the right args",
        function() {

        });

        it("should include remote senders in the context if applicable", function() {

        });

        it("should include remote targets in the context if applicable", function() {

        });

        it("should include remote rooms in the context if applicable", function() {

        });

        it("should update cached Intents", function() {

        });
    });

    describe("run", function() {
        it("should emit a 'run' event with (port, config)", function() {

        });

        it("should invoke listen(port) on the AppService instance", function() {

        });
    });

    describe("getters", function() {
        it("should be able to getRoomStore", function() {

        });

        it("should be able to getUserStore", function() {

        });

        it("should be able to getRequestFactory", function() {

        });

        it("should be able to getBot", function() {

        });
    });

    describe("getIntent", function() {
        it("should return the same intent on multiple invokations", function() {

        });

        it("should keep the Intent up-to-date with incoming events", function() {

        });

        it("should scope Intents to a request if provided", function() {

        });

        it("should provision a user with the specified user ID", function() {

        });
    });

    describe("provisionUser", function() {
        it("should provision a user with the specified user ID", function() {

        });

        it("should set the display name if one was provided", function() {

        });

        it("should set the avatar URL if one was provided", function() {

        });

        it("should link the user with a remote user if one was provided", function() {

        });

        it("should fail if the HTTP registration fails", function() {

        });
    });
});
