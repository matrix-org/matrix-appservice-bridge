import { Axios } from "axios";
import { URL } from "url";
import { isIP } from "net";
import { promises as dns, SrvRecord } from "dns"
import { Logger } from "..";

interface MatrixServerWellKnown {
    "m.server": string;
}


interface MatrixClientWellKnown {
    "m.homeserver": {
        base_url: string;
    };
    "m.identity_server": {
        base_url: string;
    };
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

const log = new Logger('MatrixHostResolver');

type CachedResult<T = HostResolveResult|MatrixClientWellKnown> =
    {timestamp: number, result: T, cacheFor: number}|{timestamp: number, error: Error};

type ServerCacheResult = CachedResult<HostResolveResult>;
type ClientCacheResult = CachedResult<MatrixClientWellKnown>;

export interface HostResolveResult {
    host: string;
    hostname: string;
    port: number;
}

interface DnsInterface {
    resolveSrv(hostname: string): Promise<SrvRecord[]>;
}


/**
 * Class to lookup the hostname, port and host headers of a given Matrix servername
 * according to the
 * [server discovery section of the spec](https://spec.matrix.org/v1.1/server-server-api/#server-discovery).
 */
export class MatrixHostResolver {
    private axios: Axios;
    private dns: DnsInterface;
    private serverResultCache = new Map<string, ServerCacheResult>();
    private clientResultCache = new Map<string, ClientCacheResult>();

    constructor(private readonly opts: {axios?: Axios, dns?: DnsInterface, currentTimeMs?: number} = {}) {
        // To allow for easier mocking.
        this.axios = opts.axios || new Axios({ timeout: WellKnownTimeout });
        this.dns = opts.dns || dns;
    }

    get currentTime(): number {
        return this.opts.currentTimeMs || Date.now();
    }


    private static sortSrvRecords(a: SrvRecord, b: SrvRecord): number {
        // This algorithm is intentionally simple, as we're unlikely
        // to encounter many Matrix servers that actually load balance this way.
        const diffPrio = a.priority - b.priority;
        if (diffPrio != 0) {
            return diffPrio;
        }
        return a.weight - b.weight;
    }

    private static determineHostType(serverName: string): {type: 4|6|"unknown", host: string, port?: number} {
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

    private async getWellKnown<T extends MatrixServerWellKnown|MatrixClientWellKnown>(
        serverName: string, kind: "server"|"client",
    ): Promise<{ data: T, cacheFor: number }> {
        const url = `https://${serverName}/.well-known/matrix/${kind}`;
        const wellKnown = await this.axios.get<T>(
            url, {
            validateStatus: null,
        });
        if (wellKnown.status !== 200) {
            throw Error('Well known request returned non-200');
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
            cacheControlHeader.find(s => s.startsWith('max-age'))?.substring("max-age=".length) || "NaN",
            10
        );

        if (maxAge) {
            cacheFor = Math.min(Math.max(maxAge * 1000, MinCacheForMs), MaxCacheForMs);
        }

        if (cacheControlHeader?.includes('no-cache') || cacheControlHeader?.includes('no-store')) {
            cacheFor = 0;
        }

        if (typeof wellKnown.data === "object") {
            return { data: wellKnown.data, cacheFor };
        }
        else if (typeof wellKnown.data === "string") {
            return {
                data: JSON.parse(wellKnown.data) as T,
                cacheFor,
            };
        }
        throw Error('Invalid datatype for well-known response');
    }

    private async getServerWellKnown(serverName: string): Promise<{mServer: string, cacheFor: number}> {
        const { data, cacheFor } = await this.getWellKnown<MatrixServerWellKnown>(serverName, "server");
        const mServer = data["m.server"];
        if (typeof mServer !== "string") {
            throw Error("Missing 'm.server' in well-known response");
        }

        const [host, portStr] = mServer.split(':');
        const port = portStr ? parseInt(portStr, 10) : DefaultMatrixServerPort;
        if (!host || (port && port < 1 || port > MaxPortNumber)) {
            throw Error("'m.server' was not in the format of <delegated_hostname>[:<delegated_port>]")
        }

        return { cacheFor, mServer };
    }

    /**
     * Resolves a Matrix serverName, fetching any delegated information.
     * This request is NOT cached. For general use, please use `resolveMatrixServer`.
     * @param hostname The Matrix `hostname` to resolve. e.g. `matrix.org`
     * @returns An object describing the delegated details for the host.
     */
    async resolveMatrixServerName(hostname: string): Promise<HostResolveResult&{cacheFor: number}> {
        // https://spec.matrix.org/v1.1/server-server-api/#resolving-server-names
        const { type, host, port } = MatrixHostResolver.determineHostType(hostname);
        // Step 1 - IP literal / Step 2
        if (type !== "unknown" || port) {
            log.debug(`Resolved ${hostname} to be IP literal / non-ip literal with port`);
            return {
                host,
                port: port || DefaultMatrixServerPort,
                // Host header should include the port
                hostname: hostname,
                cacheFor: DefaultCacheForMs,
            }
        }
        // Step 3 - Well-known
        let wellKnownResponse: {mServer: string, cacheFor: number}|undefined = undefined;
        try {
            wellKnownResponse = await this.getServerWellKnown(hostname);
            log.debug(`Resolved ${hostname} to be well-known`);
        }
        catch (ex) {
            // Fall through to step 4.
            log.debug(`No well-known found for ${hostname}: ${ex instanceof Error ? ex.message : ex}`);
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
                const [srvResult] = (await this.dns.resolveSrv(`_matrix._tcp.${hostname}`))
                    .sort(MatrixHostResolver.sortSrvRecords);
                return {
                    host: srvResult.name,
                    port: srvResult.port,
                    hostname: mServer,
                    cacheFor,
                };
            }
            catch (ex) {
                log.debug(`No well-known SRV found for ${hostname}: ${ex instanceof Error ? ex.message : ex}`);
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
            const [srvResult] = (await this.dns.resolveSrv(`_matrix._tcp.${hostname}`))
                .sort(MatrixHostResolver.sortSrvRecords);
            return {
                host: srvResult.name,
                port: srvResult.port,
                hostname: hostname,
                cacheFor: DefaultCacheForMs,
            };
        }
        catch (ex) {
            log.debug(`No SRV found for ${hostname}: ${ex instanceof Error ? ex.message : ex}`);
        }

        // Step 5 - Normal resolve
        return {
            host,
            port: port || DefaultMatrixServerPort,
            // Host header should include the port
            hostname: hostname,
            cacheFor: DefaultCacheForMs,
        }
    }

    private readCache<T extends HostResolveResult|MatrixClientWellKnown>(
        cache: Map<string, CachedResult<T>>, key: string, skipCache = false) {
        const cachedResult = skipCache ? false : cache.get(key);
        if (cachedResult) {
            const cacheAge = this.currentTime - cachedResult.timestamp;
            if ("result" in cachedResult && cacheAge <= cachedResult.cacheFor) {
                const { cacheFor } = cachedResult;
                log.debug(
                    `Cached result for ${key}, returning (alive for ${cacheFor - cacheAge}ms)`
                );
                return cachedResult.result;
            }
            else if ("error" in cachedResult && cacheAge <= CacheFailureForMS) {
                log.debug(
                    `Cached error for ${key}, throwing (alive for ${CacheFailureForMS - cacheAge}ms)`
                );
                throw cachedResult.error;
            }
            // Otherwise expired entry.
        }
        return null;
    }

    /**
     * Resolves a Matrix serverName into the baseURL for federated requests, and the
     * `Host` header to use when serving requests.
     *
     * Results are cached by default. Please note that failures are cached, determined by
     * the constant `CacheFailureForMS`.
     * @param hostname The Matrix `hostname` to resolve. e.g. `matrix.org`
     * @param skipCache Should the request be executed regardless of the cached value? Existing cached values will
     *                 be overwritten.
     * @returns The baseurl of the Matrix server (excluding /_matrix/federation suffix), and the hostHeader to be used.
     */
    public async resolveMatrixServer(hostname: string, skipCache = false): Promise<{url: URL, hostHeader: string}> {
        const cachedResult = this.readCache(this.serverResultCache, hostname, skipCache);
        if (cachedResult) {
            return {
                url: new URL(`https://${cachedResult.host}:${cachedResult.port}/`),
                hostHeader: cachedResult.hostname,
            };
        }
        try {
            const result = await this.resolveMatrixServerName(hostname);
            if (result.cacheFor) {
                this.serverResultCache.set(hostname, {
                    result,
                    timestamp: this.currentTime,
                    cacheFor: result.cacheFor
                });
            }
            log.debug(`No result cached for ${hostname}, caching result for ${result.cacheFor}ms`);
            return {
                url: new URL(`https://${result.host}:${result.port}/`),
                hostHeader: result.hostname,
            };
        }
        catch (error) {
            this.serverResultCache.set(hostname, {
                timestamp: this.currentTime,
                error: error instanceof Error ? error : Error(String(error)),
            });
            log.debug(`No result cached for ${hostname}, caching error for ${CacheFailureForMS}ms`);
            throw error;
        }
    }

    public async resolveMatrixClient(hostname: string, skipCache = false): Promise<URL> {
        // https://spec.matrix.org/latest/client-server-api/#well-known-uri
        const cachedResult = this.readCache(this.clientResultCache, hostname, skipCache);
        if (cachedResult) {
            return new URL(cachedResult["m.homeserver"].base_url);
        }

        try {
            const { data, cacheFor } = await this.getWellKnown<MatrixClientWellKnown>(hostname, "client");
            const url = data["m.homeserver"]?.base_url;
            if (typeof url !== "string") {
                throw Error('Invalid client well-known, no m.homeserver base_url entry.');
            }
            if (cacheFor) {
                this.clientResultCache.set(hostname, { result: data, timestamp: this.currentTime, cacheFor });
            }
            log.debug(`No result cached for ${hostname}, caching result for ${cacheFor}ms`);
            return new URL(url);
        }
        catch (error) {
            this.clientResultCache.set(hostname, {
                timestamp: this.currentTime,
                error: error instanceof Error ? error : Error(String(error)),
            });
            log.debug(`No result cached for ${hostname}, caching error for ${CacheFailureForMS}ms`);
            throw error;
        }

    }
}

