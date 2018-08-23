const ClientRequestCache = require("../../lib/components/client-request-cache");
const Promise = require("bluebird");

describe("ClientRequestCache", function() {
    describe("constructor", function() {
        it("Can construct", function() {
            const crc = new ClientRequestCache(50, () => { });
            expect(crc.ttl).toBe(50);
            expect(crc.requestFunc).toBeDefined();
            expect(crc._requestContent).toBeDefined();
        });

        /* eslint-disable no-new */
        it("Cannot construct with incorrect parameters", function() {
            expect(() => { new ClientRequestCache() }).toThrow();
            expect(() => { new ClientRequestCache(0, () => { })}).toThrow();
            expect(() => { new ClientRequestCache(50, undefined)}).toThrow();
            expect(() => { new ClientRequestCache("apple", () => { })}).toThrow();
            expect(() => { new ClientRequestCache(50, "apple")}).toThrow();
            expect(() => { new ClientRequestCache(-1, () => { })}).toThrow();
            expect(() => { new ClientRequestCache(0, () => { })}).toThrow();
            expect(() => { new ClientRequestCache(50.5, () => { })}).toThrow();
        });
        /* eslint-enable no-new */
    });
    describe("get", function() {
        it("should fetch a non-cached item", () => {
            const crc = new ClientRequestCache(50000, () => {
                return "Behold, the *thing*";
            });
            return crc.get("athing").then((res) => {
                expect(res).toBe("Behold, the *thing*");
            });
        });
        it("should store in the cache", () => {
            let requestCount = 0;
            const crc = new ClientRequestCache(50000, () => {
                requestCount++;
                return "Behold, the *thing*";
            });
            return crc.get("athing").then(() => {
                return crc.get("athing");
            }).then((res) => {
                expect(requestCount).toBe(1);
                expect(res).toBe("Behold, the *thing*");
            });
        });
        it("should expire old items", () => {
            let requestCount = 0;
            const crc = new ClientRequestCache(50, () => {
                requestCount++;
                return "Behold, the *thing*";
            });
            return crc.get("athing").then(() => {
                return Promise.delay(100);
            }).then(() => {
                return crc.get("athing");
            }).then((res) => {
                expect(requestCount).toBe(2);
                expect(res).toBe("Behold, the *thing*");
            });
        });
        it("should hold multiple items", () => {
            const crc = new ClientRequestCache(1000, (thing) => {
                if (thing === "1") {
                    return "Thing 1!";
                }
                return "Thing 2!";
            });
            
            return crc.get("1").then((res) => {
                expect(res).toBe("Thing 1!");
                return crc.get("2");
            }).then((res) => {
                expect(res).toBe("Thing 2!");
            });
        });
        it("should pass down failures", () => {
            const crc = new ClientRequestCache(1000, () => {
                return Promise.reject("Sorry, this test has subject to a GDPR request.");
            });
            return crc.get("1").then((res) => {
                fail("Didn't reject");
            }).catch((err) => {
                expect(err).toBe("Sorry, this test has subject to a GDPR request.");
            });
        });
        it("should pass args", () => {
            const crc = new ClientRequestCache(1000, (key, ...args) => {
                return args;
            });
            return crc.get("1", "Hey", "that's", "pretty", "cool").then((res) => {
                expect(res).toEqual(["Hey", "that's", "pretty", "cool"]);
            });
        });
        it("should reject non-string keys", () => {
            const crc = new ClientRequestCache(1000, () => { });
            expect(() => { crc.get({}) }).toThrow();
            expect(() => { crc.get(1) }).toThrow();
            expect(() => { crc.get(true) }).toThrow();
            expect(() => { crc.get(null) }).toThrow();
            expect(() => { crc.get() }).toThrow();
        });
    });
});
