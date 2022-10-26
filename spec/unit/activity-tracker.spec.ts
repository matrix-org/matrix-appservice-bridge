import "jasmine";
import { ActivityTracker } from "../../src/index";
import { WhoisInfo, PresenceEventContent, MatrixClient, MatrixError } from "matrix-bot-sdk";

function throwMatrixError(statusCode: number) {
    throw new MatrixError({errcode: "M_UNKNOWN", error: ""}, statusCode);
}

const TEST_USER = "@foobar:example.com";

function createTracker(canUseWhois: boolean = false, presence?: PresenceEventContent, whois?: WhoisInfo, defaultOnline: boolean = false) {
    const client = new MatrixClient("http://example.com", "foo");
    client.doRequest = async function (method: string, path: string) {
        if (method === "GET" && path === "/_synapse/admin/v1/users/@foo:bar/admin") {
            if (canUseWhois) {
                throwMatrixError(400);
            }
            throwMatrixError(403); // 403 - not an admin
        }
        if (method === "GET" && path.startsWith("/_matrix/client/v3/presence/")) {
            if (!presence) {
                throw Error("Presence is disabled");
            }
            return presence;
        }
        if (method === "GET" && path.startsWith("/_matrix/client/v3/admin/whois")) {
            if (!whois) {
                throw Error("Whois is disabled");
            }
            return whois;
        }
        throw Error("Path/Method is wrong");
    }
    const tracker = new ActivityTracker(client, {
        serverName: "example.com",
        usePresence: !!presence,
        defaultOnline,
    });
    return {tracker: tracker as ActivityTracker}
}

describe("ActivityTracker", () => {
    it("constructs", () => {
        const tracker: any = new ActivityTracker(
            new MatrixClient("http://example.com", "foo"),
            {
                serverName: "example.com",
                defaultOnline: false,
        });
    });
    describe("isUserOnline", () => {
        it("will enable whois if it can be used", async () => {
            const {tracker} = createTracker(true);
            tracker.setLastActiveTime(TEST_USER);
            await tracker.isUserOnline(TEST_USER, 1000);
            expect(tracker.usingWhois).toBeTrue();
        });
        it("will disable whois if it can't be used", async () => {
            const {tracker} = createTracker(false);
            tracker.setLastActiveTime(TEST_USER);
            await tracker.isUserOnline(TEST_USER, 1000);
            expect(tracker.usingWhois).toBeFalse();
        });
        it("Will return online if user was bumped recently", async () => {
            const {tracker} = createTracker(false);
            tracker.setLastActiveTime(TEST_USER);
            const res = await tracker.isUserOnline(TEST_USER, 100);
            expect(res.online).toBeTrue();
            expect(res.inactiveMs).toBeLessThan(10);
        });
        it("will return online if presence is currently active", async () => {
            const {tracker} = createTracker(false, {
                currently_active: true,
                presence: "online",
            });
            const res = await tracker.isUserOnline(TEST_USER, 1000);
            expect(res.online).toBeTrue();
            expect(res.inactiveMs).toEqual(0);
        });
        it("will return online if presence status is online", async () => {
            const {tracker} = createTracker(false, {
                currently_active: false,
                presence: "online"
            });
            const res = await tracker.isUserOnline(TEST_USER, 1000);
            expect(res.online).toBeTrue();
            expect(res.inactiveMs).toEqual(0);
        });
        it("will return offline if presence last_active_ago > maxTime", async () => {
            const {tracker} = createTracker(false, {
                currently_active: false,
                presence: "offline",
                last_active_ago: 1001
            });
            const res = await tracker.isUserOnline(TEST_USER, 1000);
            expect(res.online).toBeFalse();
            expect(res.inactiveMs).toEqual(1001);
        });
        it("will return offline if canUseWhois is false and presence couldn't be used", async () => {
            const {tracker} = createTracker(false);
            const res = await tracker.isUserOnline(TEST_USER, 1000);
            expect(res.online).toBeFalse();
            expect(res.inactiveMs).toEqual(-1);
        });
        it("will return online if the user's time is set appropriately", async () => {
            const {tracker} = createTracker(false);
            const res = await tracker.isUserOnline(TEST_USER, 1000);
            expect(res.online).toBeFalse();
            expect(res.inactiveMs).toEqual(-1);
            const time = Date.now();
            await tracker.setLastActiveTime(TEST_USER, time);
            const res2 = await tracker.isUserOnline(TEST_USER, 1000);
            expect(res2.online).toBeTrue();
            expect(res2.inactiveMs).toBeLessThan(100); // Account for some time spent.
        });
        it("will return online if presence couldn't be used and a device was recently seen", async () => {
            const now = Date.now();
            const response: WhoisInfo = {
                user_id: "@foobar:notexample.com",
                devices: {
                    foobar: {
                        sessions: [{
                            connections: [{
                                ip: "127.0.0.1",
                                last_seen: now - 500,
                                user_agent: "FakeDevice/1.0.0",
                            },{
                                ip: "127.0.0.1",
                                last_seen: now - 1500,
                                user_agent: "FakeDevice/2.0.0",
                            }],
                        }],
                    },
                    foobar500: {
                        sessions: [{
                            connections: [{
                                ip: "127.0.0.1",
                                last_seen: now - 2500,
                                user_agent: "FakeDevice/3.0.0",
                            }],
                        }],
                    },
                },
            };
            const {tracker} = createTracker(true, undefined, response);

            const res = await tracker.isUserOnline(TEST_USER, 1000);
            expect(res.online).toBeTrue();
        });
        it("will return offline if presence couldn't be used and a device was not recently seen", async () => {
            const now = Date.now();
            const response: WhoisInfo = {
                user_id: "@foobar:notexample.com",
                devices: {
                    foobar: {
                        sessions: [{
                            connections: [{
                                ip: "127.0.0.1",
                                last_seen: now - 1000,
                                user_agent: "FakeDevice/1.0.0",
                            },{
                                ip: "127.0.0.1",
                                last_seen: now - 1500,
                                user_agent: "FakeDevice/2.0.0",
                            }],
                        }],
                    },
                    foobar500: {
                        sessions: [{
                            connections: [{
                                ip: "127.0.0.1",
                                last_seen: now - 2500,
                                user_agent: "FakeDevice/3.0.0",
                            }],
                        }],
                    },
                },
            };
            const {tracker} = createTracker(true, undefined, response);

            const res = await tracker.isUserOnline(TEST_USER, 1000);
            expect(res.online).toBeFalse();
        });
        it("will default to offline if configured to", async () => {
            const {tracker} = createTracker(false, undefined, undefined, false);
            const res = await tracker.isUserOnline(TEST_USER, 1000);
            expect(res.online).toBeFalse();
            expect(res.inactiveMs).toEqual(-1);
        });
        it("will default to online if configured to", async () => {
            const {tracker} = createTracker(false, undefined, undefined, true);
            const res = await tracker.isUserOnline(TEST_USER, 1000);
            expect(res.online).toBeTrue();
            expect(res.inactiveMs).toEqual(-1);
        });
        it("will be online if defaultOnline is overriden", async () => {
            const {tracker} = createTracker(false, undefined, undefined, false);
            const res = await tracker.isUserOnline(TEST_USER, 1000, true);
            expect(res.online).toBeTrue();
            expect(res.inactiveMs).toEqual(-1);
        });
        it("will be offline if defaultOnline is overriden", async () => {
            const {tracker} = createTracker(false, undefined, undefined, true);
            const res = await tracker.isUserOnline(TEST_USER, 1000, false);
            expect(res.online).toBeFalse();
            expect(res.inactiveMs).toEqual(-1);
        });
    })
});