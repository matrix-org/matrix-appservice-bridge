"use strict";
var RequestFactory = require("../..").RequestFactory;

describe("RequestFactory", function() {
    var factory;

    beforeEach(function() {
        factory = new RequestFactory();
    });

    it("addDefaultResolveCallback should be invoked on resolved requests",
    function(done) {
        var r1, r2;

        factory.addDefaultResolveCallback(function(req, resolve) {
            if (req.getId() === r1.getId()) {
                expect(resolve).toEqual("foobar");
                r2.resolve("flibble");
            }
            else if (req.getId() === r2.getId()) {
                expect(resolve).toEqual("flibble");
                done();
            }
            else {
                expect(false).toBe(true, "Unknown req ID: " + req.getId());
            }
        });
        r1 = factory.newRequest();
        r2 = factory.newRequest();
        r1.resolve("foobar");
        factory.newRequest().reject("narp");
    });

    it("addDefaultRejectCallback should be invoked on rejected requests",
    function(done) {
        var r1, r2;

        factory.addDefaultRejectCallback(function(req, reject) {
            if (req.getId() === r1.getId()) {
                expect(reject).toEqual("foobar");
                r2.reject("flibble");
            }
            else if (req.getId() === r2.getId()) {
                expect(reject).toEqual("flibble");
                done();
            }
            else {
                expect(false).toBe(true, "Unknown req ID: " + req.getId());
            }
        });
        r1 = factory.newRequest();
        r2 = factory.newRequest();
        r1.reject("foobar");
        factory.newRequest().resolve("yup");
    });

    it("addDefaultTimeoutCallback should be invoked after a set time",
    function() {
        jasmine.Clock.useMock();

        var fired = false;
        factory.addDefaultTimeoutCallback(function(req) {
            fired = true;
        }, 1500);
        factory.newRequest();
        jasmine.Clock.tick(1000);
        expect(fired).toBe(false);
        jasmine.Clock.tick(500);
        expect(fired).toBe(true);
    });

    it("addDefaultTimeoutCallback should not be invoked on resolved requests",
    function() {
        var r1;
        jasmine.Clock.useMock();

        var fired = false;
        factory.addDefaultTimeoutCallback(function(req) {
            fired = true;
        }, 1500);
        r1 = factory.newRequest();
        jasmine.Clock.tick(1000);
        r1.resolve("yup");
        jasmine.Clock.tick(1000);
        expect(fired).toBe(false);
    });

    it("addDefaultTimeoutCallback should not be invoked on rejected requests",
    function() {
        var r1;
        jasmine.Clock.useMock();

        var fired = false;
        factory.addDefaultTimeoutCallback(function(req) {
            fired = true;
        }, 1500);
        r1 = factory.newRequest();
        jasmine.Clock.tick(1000);
        r1.reject("narp");
        jasmine.Clock.tick(1000);
        expect(fired).toBe(false);
    });
});
