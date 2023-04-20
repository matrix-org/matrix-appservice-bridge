

import { Intent, MatrixUser, WeakStateEvent, Logger, MatrixHostResolver } from "..";
import { MatrixGlob } from "matrix-bot-sdk";
import axios from "axios";

const log = new Logger("MatrixBanSync");

const CACHE_HOMESERVER_PROPERTIES_FOR_MS = 1000 * 60 * 30; // 30 minutes

export interface MatrixBanSyncConfig {
    rooms?: string[];
    blockByRegistrationStatus: RegistrationStatus[];
}

enum BanEntityType {
    Server = "m.policy.rule.server",
    User = "m.policy.rule.user"
}

interface BanEntity {
    matcher: MatrixGlob;
    entityType: BanEntityType;
    reason: string;
}

interface MPolicyContent {
    entity: string;
    reason: string;
    recommendation: "m.ban";
}

function eventTypeToBanEntityType(eventType: string): BanEntityType|null {
    switch (eventType) {
        case "m.policy.rule.user":
        case "org.matrix.mjolnir.rule.user":
            return BanEntityType.User;
        case "m.policy.rule.server":
        case "org.matrix.mjolnir.rule.server":
            return BanEntityType.Server
        default:
            return null;
    }
}

const supportedRecommendations = [
    "org.matrix.mjolnir.ban", // Used historically.
    "m.ban"
];

interface MatrixRegistrationResponse {
    flows: {
        stages: string[],
    }[],
}

enum RegistrationStatus {
    Unknown = 0,
    Open = 1,
    ProtectedEmail = 2,
    ProtectedCaptcha = 3,
    Closed = 4,
}

const AuthTypeRecaptcha = 'm.login.recaptcha';
const AuthTypeEmail = 'm.login.email.identity';

export class MatrixBanSyncError extends Error {
    constructor(message: string, private readonly cause?: Error) {
        super(message);
    }
}

/**
 * Synchronises Matrix `m.policy.rule` events with the bridge to filter specific
 * users from using the service.
 */
export class MatrixBanSync {
    private readonly homeserverPropertiesCache = new Map<string, {
        registrationStatus: RegistrationStatus; ts: number;
    }>();
    private readonly bannedEntites = new Map<string, BanEntity>();
    private readonly subscribedRooms = new Set<string>();
    private readonly hostResolver = new MatrixHostResolver();
    constructor(private config: MatrixBanSyncConfig) {

    }

    /**
     * Determine the state of the homeservers user registration system.
     *
     * @param url The base URL for the C-S API of the homeserver.
     * @returns A status enum.
     */
    private static async getRegistrationStatus(url: URL): Promise<RegistrationStatus> {
        let registrationResponse = await axios.post(new URL('/_matrix/client/v3/register', url).toString(), { });
        if (registrationResponse.status === 404) {
            // Fallback to old APIs
            registrationResponse = await axios.post(new URL('/_matrix/client/r0/register', url).toString(), { });
        }


        if (registrationResponse.status === 403 && registrationResponse.data.errcode === 'M_FORBIDDEN') {
            // Explicitly forbidden private server -> great!
            return RegistrationStatus.Closed;
        }

        if (registrationResponse.status === 404) {
            // Endpoint is not connected, probably also great!
            return RegistrationStatus.Closed;
        }

        if (registrationResponse.status === 401) {
            // Look at the flows.
            const { flows } = registrationResponse.data as MatrixRegistrationResponse;
            if (!flows) {
                // Invalid response
                return RegistrationStatus.Unknown;
            }

            if (flows.length === 0) {
                // No available flows, so closed.
                return RegistrationStatus.Closed;
            }

            let openReg = RegistrationStatus.Unknown;
            // Check the flows
            for (const flow of flows) {
                // A flow with recaptcha
                if (openReg > RegistrationStatus.ProtectedCaptcha && flow.stages.includes(AuthTypeRecaptcha)) {
                    openReg = RegistrationStatus.ProtectedCaptcha;
                }
                // A flow without any recaptcha stages
                if (openReg > RegistrationStatus.ProtectedEmail &&
                    flow.stages.includes(AuthTypeEmail) && !flow.stages.includes(AuthTypeRecaptcha)) {
                    openReg = RegistrationStatus.ProtectedEmail;
                }
                // A flow without any email or recaptcha stages
                if (openReg > RegistrationStatus.Open &&
                    !flow.stages.includes(AuthTypeEmail) && !flow.stages.includes(AuthTypeRecaptcha)) {
                    openReg = RegistrationStatus.Open;
                    // Already as bad as it gets
                    break;
                }
            }
            return openReg;
        }

        return RegistrationStatus.Unknown;
    }

    /**
     * Get properties about a given homeserver that may influence the rules
     * applied to it.
     * @param serverName The homeserver name.
     * @returns A set of properties.
     * @throws
     */
    public async getHomeserverProperties(serverName: string) {
        const hsData = this.homeserverPropertiesCache.get(serverName);
        // Slightly fuzz the ttl.
        const ttl = Date.now() + CACHE_HOMESERVER_PROPERTIES_FOR_MS + (Math.random()*60000);
        if (hsData && hsData.ts < ttl) {
            return hsData;
        }
        const url = await this.hostResolver.resolveMatrixClient(serverName, true);

        const hsProps = {
            registrationStatus: await MatrixBanSync.getRegistrationStatus(url),
            ts: Date.now(),
        };
        this.homeserverPropertiesCache.set(serverName, hsProps);
        return hsProps;
    }

    public async syncRules(intent: Intent) {
        this.bannedEntites.clear();
        this.subscribedRooms.clear();
        for (const roomIdOrAlias of this.config.rooms || []) {
            try {
                const roomId = await intent.join(roomIdOrAlias);
                this.subscribedRooms.add(roomId);
                const roomState = await intent.roomState(roomId, false) as WeakStateEvent[];
                for (const evt of roomState) {
                    this.handleIncomingState(evt, roomId);
                }
            }
            catch (ex) {
                log.error(`Failed to read ban list from ${roomIdOrAlias}`, ex);
            }
        }
    }

    /**
     * Is the given room considered part of the bridge's ban list set.
     * @param roomId A Matrix room ID.
     * @returns true if state should be handled from the room, false otherwise.
     */
    public isTrackingRoomState(roomId: string): boolean {
        return this.subscribedRooms.has(roomId);
    }

    /**
     * Checks to see if the incoming state is a recommendation entry.
     * @param evt A Matrix state event. Unknown state events will be filtered out.
     * @param roomId The Matrix roomID where the event came from.
     * @returns `true` if the event was a new ban, and existing clients should be checked. `false` otherwise.
     */
    public handleIncomingState(evt: WeakStateEvent, roomId: string) {
        const content = evt.content as unknown as MPolicyContent;
        const entityType = eventTypeToBanEntityType(evt.type);
        if (!entityType) {
            return false;
        }
        const key = `${roomId}:${evt.state_key}`;
        if (evt.content.entity === undefined) {
            // Empty, delete instead.
            log.info(`Deleted ban rule ${evt.type}/$ matching ${key}`);
            this.bannedEntites.delete(key);
            return false;
        }
        if (!supportedRecommendations.includes(content.recommendation)) {
            return false;
        }
        if (typeof content.entity !== "string" || content.entity === "") {
            throw Error('`entity` key is not valid, must be a non-empty string');
        }
        this.bannedEntites.set(key, {
            matcher: new MatrixGlob(content.entity),
            entityType,
            reason: content.reason || "No reason given",
        });
        log.info(`New ban rule ${evt.type} matching ${content.entity}`);
        return true;
    }

    /**
     * Check if a user is banned by via a ban list.
     * @param user A userId string or a MatrixUser object.
     * @returns Either a string reason for the ban, or false if the user was not banned.
     */
    public async isUserBanned(user: MatrixUser|string): Promise<string|false> {
        const matrixUser = typeof user === "string" ? new MatrixUser(user) : user;
        for (const entry of this.bannedEntites.values()) {
            if (entry.entityType === BanEntityType.Server && entry.matcher.test(matrixUser.host)) {
                return entry.reason;
            }
            if (entry.entityType === BanEntityType.User && entry.matcher.test(matrixUser.userId)) {
                return entry.reason;
            }
        }

        if (this.config.blockByRegistrationStatus) {
            // Check the user's homeserver.
            const { registrationStatus } = await this.getHomeserverProperties(matrixUser.host);
            if (this.config.blockByRegistrationStatus.includes(registrationStatus)) {
                const statusName = RegistrationStatus[registrationStatus];
                return `${matrixUser.host} has ${statusName} registration, which is blocked by this bridge.`
            }
        }
        return false;
    }

    /**
     * Should be called when the bridge config has been updated.
     * @param config The new config.
     * @param intent The bot user intent.
     */
    public async updateConfig(config: MatrixBanSyncConfig, intent: Intent) {
        this.config = config;
        await this.syncRules(intent);
    }
}
