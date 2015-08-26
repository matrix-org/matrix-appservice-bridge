var Request = require("../..").Request;

describe("Request", function() {
    var req;

    it("getData should return data set in the constructor", function() {
        req = new Request({
            data: "foobar"
        });
        expect(req.getData()).toEqual("foobar");
    });

    it("getId should return the ID set in the constructor", function() {
        req = new Request({
            id: "abc123"
        });
        expect(req.getId()).toEqual("abc123");
    });

    it("getId should generate an ID if one is not supplied in the constructor",
    function() {
        req = new Request();
        expect(req.getId()).toBeDefined();
    });

    it("getDuration should return time elapsed since construction", function(done) {
        req = new Request({
            data: "foobar"
        });
        setTimeout(function() {
            expect(req.getDuration()).toBeGreaterThan(90);
            done();
        }, 100);
    });

    it("resolve should resolve the promise in getPromise", function(done) {
        req = new Request();
        req.getPromise().done(function(thing) {
            expect(thing).toEqual("flibble");
            done();
        })
        req.resolve("flibble");
    });

    it("reject should reject the promise in getPromise", function(done) {
        req = new Request();
        req.getPromise().catch(function(thing) {
            expect(thing).toEqual("flibble");
            done();
        })
        req.reject("flibble");
    });
});
