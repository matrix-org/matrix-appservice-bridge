import { SrvRecord } from "dns";
import "jasmine";
import { MatrixHostResolver, DefaultCacheForMs, MaxCacheForMs, MinCacheForMs } from "../../../src/index";

function createMHR(wellKnownServerName?: string, wellKnownHeaders: {[key: string]: string} = {}, srvRecords?: SrvRecord[], currentTimeMs?: number) {
    const fetchFn = async () => ({
            ok: !!wellKnownServerName,
            headers: new Headers(wellKnownHeaders),
            status: wellKnownServerName ? 200 : 404,
            json: async () => ( wellKnownServerName ? {'m.server': wellKnownServerName} : {"error": "Test failure"})
    } satisfies Partial<Response>) as unknown ;
    const dns = {
        resolveSrv: async () => {
            if (srvRecords) {
                return srvRecords;
            } else {
                throw Error('No SRV records;')
            }
        }
    }
    return new MatrixHostResolver({fetch: fetchFn as (typeof fetch), dns, currentTimeMs});
}

describe("MatrixHostResolver", () => {
    describe("IP literals", () => {
        it("resolves an IPv4 literal", async () => {
            expect(await createMHR().resolveMatrixServerName("127.0.0.1")).toEqual({
                host: "127.0.0.1",
                port: 8448,
                hostname: "127.0.0.1",
                cacheFor: DefaultCacheForMs,
            });
        });
        it("resolves an IPv6 literal", async () => {
            expect(await createMHR().resolveMatrixServerName("2620:0:860:2:208:80:153:45")).toEqual({
                host: "2620:0:860:2:208:80:153:45",
                port: 8448,
                hostname: "2620:0:860:2:208:80:153:45",
                cacheFor: DefaultCacheForMs,
            });
        });
        // Step 2 - Ports
        it("resolves an IPv4 literal with a port", async () => {
            expect(await createMHR().resolveMatrixServerName("127.0.0.1:1234")).toEqual({
                host: "127.0.0.1",
                port: 1234,
                hostname: "127.0.0.1:1234",
                cacheFor: DefaultCacheForMs,
            });
        });
        it("resolves an IPv6 literal with a port", async () => {
            expect(await createMHR().resolveMatrixServerName("[2620:0:860:2:208:80:153:45]:1234")).toEqual({
                host: "[2620:0:860:2:208:80:153:45]",
                port: 1234,
                hostname: "[2620:0:860:2:208:80:153:45]:1234",
                cacheFor: DefaultCacheForMs,
            });
        });
    });

    describe("SRV Records", () => {
        it("resolves a host with SRV delegation", async () => {
            const mhr = createMHR(undefined, undefined, [{
                name: "srv-delegated-dont-use-me.host",
                port: 3344,
                priority: 20,
                weight: 10,
            },{
                name: "srv-delegated-or-use-me.host",
                port: 1122,
                priority: 10,
                weight: 10,
            },{
                name: "srv-delegated.host",
                port: 1234,
                priority: 10,
                weight: 0,
            }]);
            expect(await mhr.resolveMatrixServerName("example.org")).toEqual({
                host: "srv-delegated.host",
                port: 1234,
                hostname: "example.org",
                cacheFor: DefaultCacheForMs,
            });
        });
    })

    describe("Well known", () => {
        it("resolves an host with well known delegation", async () => {
            const mhr = createMHR("federation.example.org");
            expect(await mhr.resolveMatrixServerName("example.org")).toEqual({
                host: "federation.example.org",
                port: 8448,
                hostname: "federation.example.org",
                cacheFor: DefaultCacheForMs,
            });
        });
        it("resolves an host with well known delegation, retaining the port", async () => {
            const mhr = createMHR("federation.example.org:443");
            expect(await mhr.resolveMatrixServerName("example.org")).toEqual({
                host: "federation.example.org",
                port: 443,
                hostname: "federation.example.org:443",
                cacheFor: DefaultCacheForMs,
            });
        });
        it("resolves an host with well known delegation, and handles the IPv4 literal", async () => {
            const mhr = createMHR("127.0.0.1");
            expect(await mhr.resolveMatrixServerName("example.org")).toEqual({
                host: "127.0.0.1",
                port: 8448,
                hostname: "127.0.0.1",
                cacheFor: DefaultCacheForMs,
            });
        });
        it("resolves an host with well known delegation, and handles the IPv6 literal", async () => {
            const mhr = createMHR("2620:0:860:2:208:80:153:45");
            expect(await mhr.resolveMatrixServerName("example.org")).toEqual({
                host: "2620:0:860:2:208:80:153:45",
                port: 8448,
                hostname: "2620:0:860:2:208:80:153:45",
                cacheFor: DefaultCacheForMs,
            });
        });
        it("resolves an host with well known delegation, and handles the IPv4 literal while retaining the port", async () => {
            const mhr = createMHR("127.0.0.1:1234");
            expect(await mhr.resolveMatrixServerName("example.org")).toEqual({
                host: "127.0.0.1",
                port: 1234,
                hostname: "127.0.0.1:1234",
                cacheFor: DefaultCacheForMs,
            });
        });
        it("resolves an host with well known delegation, and handles the IPv6 literal while retaining the port", async () => {
            const mhr = createMHR("[2620:0:860:2:208:80:153:45]:1234");
            expect(await mhr.resolveMatrixServerName("example.org")).toEqual({
                host: "[2620:0:860:2:208:80:153:45]",
                port: 1234,
                hostname: "[2620:0:860:2:208:80:153:45]:1234",
                cacheFor: DefaultCacheForMs,
            });
        });
        it("resolves an host with well known delegation, and handles SRV delegation", async () => {
            const mhr = createMHR("federation.example.org", undefined, [{
                name: "srv-delegated-dont-use-me.host",
                port: 3344,
                priority: 20,
                weight: 10,
            },{
                name: "srv-delegated-or-use-me.host",
                port: 1122,
                priority: 10,
                weight: 10,
            },{
                name: "srv-delegated.host",
                port: 1234,
                priority: 10,
                weight: 0,
            }]);
            expect(await mhr.resolveMatrixServerName("example.org")).toEqual({
                host: "srv-delegated.host",
                port: 1234,
                hostname: "federation.example.org",
                cacheFor: DefaultCacheForMs,
            });
        });
        it("processes Expires headers correctly", async () => {
            const now = new Date();
            const nowMs = now.getTime() - now.getMilliseconds();
            const mhr = createMHR("federation.example.org", {
                Expires: (new Date(nowMs + 600000)).toString()
            }, undefined, nowMs);
            expect(await mhr.resolveMatrixServerName("example.org")).toEqual({
                host: "federation.example.org",
                port: 8448,
                hostname: "federation.example.org",
                cacheFor: 600000,
            });
        });
        it("processes Cache-Control max-age headers correctly", async () => {
            const mhr = createMHR("federation.example.org", {"Cache-Control": "max-age=600"});
            expect(await mhr.resolveMatrixServerName("example.org")).toEqual({
                host: "federation.example.org",
                port: 8448,
                hostname: "federation.example.org",
                cacheFor: 600000,
            });
        });
        it("processes Cache-Control no-cache headers correctly", async () => {
            const mhr = createMHR("federation.example.org", {"Cache-Control": "no-cache"});
            expect(await mhr.resolveMatrixServerName("example.org")).toEqual({
                host: "federation.example.org",
                port: 8448,
                hostname: "federation.example.org",
                cacheFor: 0,
            });
        });
        it("processes Cache-Control no-store headers correctly", async () => {
            const mhr = createMHR("federation.example.org", {"Cache-Control": "no-store"});
            expect(await mhr.resolveMatrixServerName("example.org")).toEqual({
                host: "federation.example.org",
                port: 8448,
                hostname: "federation.example.org",
                cacheFor: 0,
            });
        });
        it("ranks Cache-Control max-age headers above Expires", async () => {
            const now = new Date();
            const nowMs = now.getTime() - now.getMilliseconds();
            const mhr = createMHR("federation.example.org", {
                Expires: (new Date(nowMs + 600000)).toString(),
                "Cache-Control": "max-age=900"
            }, undefined, nowMs);
            expect(await mhr.resolveMatrixServerName("example.org")).toEqual({
                host: "federation.example.org",
                port: 8448,
                hostname: "federation.example.org",
                cacheFor: 900000,
            });
        });
        it("ranks Cache-Control no-store Headers above max-age", async () => {
            const now = new Date();
            const nowMs = now.getTime() - now.getMilliseconds();
            const mhr = createMHR("federation.example.org", {
                Expires: (new Date(nowMs + 600000)).toString(),
                "Cache-Control": "max-age=900, no-store"
            }, undefined, nowMs);
            expect(await mhr.resolveMatrixServerName("example.org")).toEqual({
                host: "federation.example.org",
                port: 8448,
                hostname: "federation.example.org",
                cacheFor: 0,
            });
        });
        it("ranks Cache-Control no-cache Headers above max-age", async () => {
            const now = new Date();
            const nowMs = now.getTime() - now.getMilliseconds();
            const mhr = createMHR("federation.example.org", {
                Expires: (new Date(nowMs + 600000)).toString(),
                "Cache-Control": "max-age=900, no-cache"
            }, undefined, nowMs);
            expect(await mhr.resolveMatrixServerName("example.org")).toEqual({
                host: "federation.example.org",
                port: 8448,
                hostname: "federation.example.org",
                cacheFor: 0,
            });
        });
        it("limits the maximum cache time", async () => {
            const mhr = createMHR("federation.example.org", {
                "Cache-Control": "max-age=9000000000"
            });
            expect(await mhr.resolveMatrixServerName("example.org")).toEqual({
                host: "federation.example.org",
                port: 8448,
                hostname: "federation.example.org",
                cacheFor: MaxCacheForMs,
            });
        });
        it("limits the minimum cache time", async () => {
            const mhr = createMHR("federation.example.org", {
                "Cache-Control": "max-age=5"
            });
            expect(await mhr.resolveMatrixServerName("example.org")).toEqual({
                host: "federation.example.org",
                port: 8448,
                hostname: "federation.example.org",
                cacheFor: MinCacheForMs,
            });
        });
    });
});