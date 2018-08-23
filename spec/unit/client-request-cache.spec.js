const ClientRequestCache = require("../../lib/components/client-request-cache");
const Promise = require("bluebird");

describe("ClientRequestCache", function() {
    describe("constructor", function() {
        it("Can construct", function() {
            const crc = new ClientRequestCache(50, 1, () => { });
            expect(crc.ttl).toBe(50);
            expect(crc.maxSize).toBe(1);
        });

        /* eslint-disable no-new */
        it("Cannot construct with incorrect parameters", function() {
            expect(() => { new ClientRequestCache() }).toThrow();
            expect(() => { new ClientRequestCache(0, 0, () => { })}).toThrow();
            expect(() => { new ClientRequestCache(50, 1, undefined)}).toThrow();
            expect(() => { new ClientRequestCache("apple", "banana", () => { })}).toThrow();
            expect(() => { new ClientRequestCache(50, "apple")}).toThrow();
            expect(() => { new ClientRequestCache(-1, -2, () => { })}).toThrow();
            expect(() => { new ClientRequestCache(0, 0, () => { })}).toThrow();
            expect(() => { new ClientRequestCache(50.5, 45.1, () => { })}).toThrow();
        });
        /* eslint-enable no-new */
    });
    describe("get", function() {
        it("should fetch a non-cached item", () => {
            const crc = new ClientRequestCache(50000, 1, () => {
                return "Behold, the *thing*";
            });
            return crc.get("athing").then((res) => {
                expect(res).toBe("Behold, the *thing*");
            });
        });
        it("should store in the cache", () => {
            let requestCount = 0;
            const crc = new ClientRequestCache(50000, 1, () => {
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
            const crc = new ClientRequestCache(50, 2, () => {
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
            const crc = new ClientRequestCache(1000, 2, (thing) => {
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

        it("should pass down failures (reject)", () => {
            const crc = new ClientRequestCache(1000, 1, () => {
                return Promise.reject("Sorry, this test has subject to a GDPR request.");
            });
            return crc.get("1").then((res) => {
                fail("Didn't reject");
            }).catch((err) => {
                expect(err).toBe("Sorry, this test has subject to a GDPR request.");
            });
        });

        it("should pass down failures (throw)", () => {
            const crc = new ClientRequestCache(1000, 1, () => {
                throw Error("Sorry, this test has subject to a GDPR request.");
            });
            return crc.get("1").then((res) => {
                fail("Didn't reject");
            }).catch((err) => {
                expect(err.message).toBe("Sorry, this test has subject to a GDPR request.");
            });
        });

        it("should pass args", () => {
            const crc = new ClientRequestCache(1000, 1, (key, ...args) => {
                return args;
            });
            return crc.get("1", "Hey", "that's", "pretty", "cool").then((res) => {
                expect(res).toEqual(["Hey", "that's", "pretty", "cool"]);
            });
        });
        it("should reject non-string keys", () => {
            const crc = new ClientRequestCache(1000, 1, () => { });
            expect(() => { crc.get({}) }).toThrow();
            expect(() => { crc.get(1) }).toThrow();
            expect(() => { crc.get(true) }).toThrow();
            expect(() => { crc.get(null) }).toThrow();
            expect(() => { crc.get() }).toThrow();
        });
        it("should respect max size", () => {
            const crc = new ClientRequestCache(1000, 2, (key) => `${key}baa`);
            return Promise.all([
                crc.get("1"),
                crc.get("2"),
                crc.get("3"),
                crc.get("4"),
            ]).then(() => {
                expect([...crc.getCachedResults().values()].map((v) => v.content)).toEqual([
                    "3baa",
                    "4baa",
                ]);
            });
        });
    });
});
