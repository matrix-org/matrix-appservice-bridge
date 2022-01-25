import { Axios } from "axios";
import { URL } from "url";
import { isIP } from "net";
import { promises as dns, SrvRecord } from "dns"
import Logging from "../components/logging";

interface MatrixServerWellKnown {
    "m.server": string;
}

const OneMinute = 1000 * 60;
const OneHour = OneMinute * 60;

export const MinCacheForMs = OneMinute * 5;
export const MaxCacheForMs = OneHour * 48;
export const DefaultCacheForMs = OneHour * 24;
const CacheFailureForMS = MinCacheForMs;
const DefaultMatrixServerPort = 8448;
const MaxPortNumber = 65535;
const WellKnownTimeout = 10000;

const log = Logging.get('MatrixHostResolver');

type CachedResult = {timestamp: number, result: HostResolveResult}|{timestamp: number, error: Error};

export interface HostResolveResult {
    host: string;
    hostname: string;
    port: number;
    cacheFor: number;
}

interface DnsInterface {
    resolveSrv(hostname: string): Promise<SrvRecord[]>;
}

export class MatrixHostResolver {

    private axios: Axios;
    private dns: DnsInterface;

    constructor(private readonly opts: {axios?: Axios, dns?: DnsInterface, currentTimeMs?: number} = {}) {
        // To allow for easier mocking.
        this.axios = opts.axios || new Axios({ timeout: WellKnownTimeout });
        this.dns = opts.dns || dns;
    }

    get currentTime(): number {
        return this.opts.currentTimeMs || Date.now();
    }

    private resultCache = new Map<string, CachedResult>();

    static sortSrvRecords(a: SrvRecord, b: SrvRecord): number {
        // This algorithm is intentionally simple, as we're unlikely
        // to encounter many Matrix servers that acatually load balance this way.
        const diffPrio = a.priority - b.priority;
        if (diffPrio != 0) {
            return diffPrio;
        }
        return a.weight - b.weight;
    }

    static determineHostType(serverName: string): {type: 4|6|"unknown", host: string, port?: number} {
        const hostPortPair = /(.+):(\d+)/.exec(serverName);
        let host = serverName;
        let port = undefined;
        if (hostPortPair) {
            port = parseInt(hostPortPair[2]);
            if (host.startsWith('[') && host.endsWith(']')) {
                host = host.slice(1, host.length - 2);
                // IPv6 square bracket notation
                if (isIP(host) !== 6) {
                    throw Error('Unknown IPv6 notation');
                }
            }
            else if (isIP(serverName) === 6) {
                // Address is IPv6, but it doesn't have a port
                port = undefined;
                host = serverName;
            }
            else {
                host = hostPortPair[1];
            }
        }

        const ipResult = isIP(host) as 4|6|0;
        return {
            type: ipResult === 0 ? "unknown" : ipResult,
            port,
            host,
        }
    }

    private async getWellKnown(serverName: string): Promise<{mServer: string, cacheFor: number}> {
        const url = `https://${serverName}/.well-known/matrix/server`;
        const wellKnown = await this.axios.get<MatrixServerWellKnown>(
            url, {
            validateStatus: null,
        });
        if (wellKnown.status !== 200) {
            throw Error('Well known request returned non-200');
        }
        const mServer = wellKnown.data["m.server"];
        if (typeof mServer !== "string") {
            throw Error("Missing 'm.server' in well-known response");
        }

        const [host, portStr] = mServer.split(':');
        const port = portStr ? parseInt(portStr, 10) : DefaultMatrixServerPort;
        if (!host || (port && port < 1 || port > MaxPortNumber)) {
            throw Error("'m.server' was not in the format of <delegated_hostname>[:<delegated_port>]")
        }

        let cacheFor = DefaultCacheForMs;
        if (wellKnown.headers['Expires']) {
            try {
                cacheFor = new Date(wellKnown.headers['Expires']).getTime() - this.currentTime;
            }
            catch (ex) {
                log.warn(`Expires header provided by ${url} could not be parsed`, ex);
            }
        }

        // https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Cache-Control
        const cacheControlHeader = wellKnown.headers['Cache-Control']?.toLowerCase()
            .split(',')
            .map(s => s.trim()) || [];

        const maxAge = parseInt(
            cacheControlHeader.find(s => s.startsWith('max-age'))?.substr("max-age=".length) || "NaN",
            10
        );

        if (maxAge) {
            cacheFor = Math.min(Math.max(maxAge * 1000, MinCacheForMs), MaxCacheForMs);
        }

        if (cacheControlHeader?.includes('no-cache') || cacheControlHeader?.includes('no-store')) {
            cacheFor = 0;
        }

        return { cacheFor, mServer };
    }

    async resolveMatrixServerName(serverName: string): Promise<HostResolveResult> {
        // https://spec.matrix.org/v1.1/server-server-api/#resolving-server-names
        const { type, host, port } = MatrixHostResolver.determineHostType(serverName);
        // Step 1 - IP literal / Step 2
        if (type !== "unknown" || port) {
            log.debug(`Resolved ${serverName} to be IP literal / non-ip literal with port`);
            return {
                host,
                port: port || DefaultMatrixServerPort,
                // Host header should include the port
                hostname: serverName,
                cacheFor: DefaultCacheForMs,
            }
        }
        // Step 3 - Well-known
        let wellKnownResponse: {mServer: string, cacheFor: number}|undefined = undefined;
        try {
            wellKnownResponse = await this.getWellKnown(serverName);
            log.debug(`Resolved ${serverName} to be well-known`);
        }
        catch (ex) {
            // Fall through to step 4.
            log.debug(`No well-known found for ${serverName}: ${ex.message}`);
        }

        if (wellKnownResponse) {
            const { mServer, cacheFor } = wellKnownResponse;
            const wkHost = MatrixHostResolver.determineHostType(mServer);
            // 3.1 / 3.2
            if (type !== "unknown" || wkHost.port) {
                return {
                    host: wkHost.host,
                    port: wkHost.port || DefaultMatrixServerPort,
                    // Host header should include the port
                    hostname: mServer,
                    cacheFor,
                }
            }
            // 3.3
            try {
                const [srvResult] = (await this.dns.resolveSrv(`_matrix._tcp.${serverName}`))
                    .sort(MatrixHostResolver.sortSrvRecords);
                return {
                    host: srvResult.name,
                    port: srvResult.port,
                    hostname: mServer,
                    cacheFor,
                };
            }
            catch (ex) {
                log.debug(`No well-known SRV found for ${serverName}: ${ex.message}`);
            }
            // 3.4
            return {
                host: wkHost.host,
                port: wkHost.port || DefaultMatrixServerPort,
                // Host header should include the port
                hostname: mServer,
                cacheFor,
            }
        }

        // Step 4 - SRV
        try {
            const [srvResult] = (await this.dns.resolveSrv(`_matrix._tcp.${serverName}`))
                .sort(MatrixHostResolver.sortSrvRecords);
            return {
                host: srvResult.name,
                port: srvResult.port,
                hostname: serverName,
                cacheFor: DefaultCacheForMs,
            };
        }
        catch (ex) {
            log.debug(`No SRV found for ${serverName}: ${ex.message}`);
        }

        // Step 5 - Normal resolve
        return {
            host,
            port: port || DefaultMatrixServerPort,
            // Host header should include the port
            hostname: serverName,
            cacheFor: DefaultCacheForMs,
        }
    }


    async getMatrixServerURL(serverName: string, skipCache = false): Promise<{url: URL, hostname: string}> {
        const cachedResult = skipCache ? false : this.resultCache.get(serverName);
        if (cachedResult) {
            const cacheAge = this.currentTime - cachedResult.timestamp;
            if ("result" in cachedResult && cacheAge <= cachedResult.result.cacheFor) {
                const result = cachedResult.result;
                log.debug(
                    `Cached result for ${serverName}, returning (alive for ${result.cacheFor - cacheAge}ms)`
                );
                return {
                    url: new URL(`https://${result.host}:${result.port}/`),
                    hostname: result.hostname,
                };
            }
            else if ("error" in cachedResult && cacheAge <= CacheFailureForMS) {
                log.debug(
                    `Cached error for ${serverName}, throwing (alive for ${CacheFailureForMS - cacheAge}ms)`
                );
                throw cachedResult.error;
            }
            // Otherwise expired entry.
        }
        try {
            const result = await this.resolveMatrixServerName(serverName);
            if (result.cacheFor) {
                this.resultCache.set(serverName, { result, timestamp: this.currentTime});
            }
            log.debug(`No result cached for ${serverName}, caching result for ${result.cacheFor}ms`);
            return {
                url: new URL(`https://${result.host}:${result.port}/`),
                hostname: result.hostname,
            };
        }
        catch (error) {
            this.resultCache.set(serverName, { error, timestamp: this.currentTime});
            log.debug(`No result cached for ${serverName}, caching error for ${CacheFailureForMS}ms`);
            throw error;
        }
    }
}

