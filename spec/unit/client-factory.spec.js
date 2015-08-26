"use strict";
var ClientFactory = require("../..").ClientFactory;

describe("ClientFactory", function() {
    var factory, req;

    beforeEach(function() {
        factory = new ClientFactory();
        factory.configure("example.com", "my_secret_token");
        req = {
            getId: function() { return "abc123"; },
            getPromise: function() {
                return {
                    then: function() {},
                    done: function() {},
                    finally: function(fn) {
                        req._fins.push(fn);
                    }
                }
            }
        };
        req._fins = [];
    });

    describe("getClientAs", function() {
        it("should get a client instance for a user ID", function() {
            var cli = factory.getClientAs("@foo:bar");
            expect(cli).toBeDefined();
        });

        it("should return the same client instance for the same user ID", function() {
            var cli = factory.getClientAs("@foo:bar");
            expect(cli).toBeDefined();
            expect(factory.getClientAs("@foo:bar")).toEqual(cli);
        });

        it("should return the same client instance for the same user ID and request",
        function() {
            var cli = factory.getClientAs("@foo:bar", req);
            expect(cli).toBeDefined();
            expect(factory.getClientAs("@foo:bar", req)).toEqual(cli);
            expect(factory.getClientAs("@foo:bar")).not.toEqual(cli);
        });

        it("should return a new client instance after the request is fulfilled",
        function() {
            var cli = factory.getClientAs("@foo:bar", req);
            expect(cli).toBeDefined();
            req._fins.forEach(function(fn) {
                fn();
            });
            expect(factory.getClientAs("@foo:bar", req)).not.toEqual(cli);
        });
    });
});
