import { MembershipCache } from "./membership-cache";
import { AppServiceBot } from "./app-service-bot";
import { WeakEvent } from "./event-types";
import { EphemeralEvent, PresenceEvent, ReadReceiptEvent, TypingEvent } from "./event-types";
import { Intent } from "./intent";
import Logging from "./logging";
import matrixcs from "matrix-js-sdk";

// matrix-js-sdk lacks types
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Filter } = require('matrix-js-sdk');

const log = Logging.get("EncryptedEventBroker");

export const APPSERVICE_LOGIN_TYPE = "uk.half-shot.msc2778.login.application_service";
const PRESENCE_CACHE_FOR_MS = 30000;

export interface ClientEncryptionSession {
    userId: string;
    deviceId: string;
    accessToken: string;
}
export interface ClientEncryptionStore {
    getStoredSession(userId: string): Promise<ClientEncryptionSession|null>;
    setStoredSession(session: ClientEncryptionSession): Promise<void>;
}

const SYNC_FILTER = {
    room: {
        include_leave: false,
        state: {
            types: ["a.invalid.type.because.empty.means.all.types"],
            limit: 0,
        },
        timeline: {
            types: ["m.room.encrypted"],
            // To reduce load, ideally we wouldn't care at all.
            lazy_load_members: true,
        },
        account_data: {
            limit: 0,
        }
    },
};

interface DedupePresence {
    userId: string;
    currentlyActive?: boolean;
    presence: "online"|"offline"|"unavailable";
    statusMsg?: string;
    ts: number;
}
/**
 * The EncryptedEventBroker ensures that we provide a single encrypted
 * event to bridges from potentially multiple /sync responses. The broker
 * is also responsible for starting these syncs depending on which users
 * can read the room.
 *
 * More broadly speaking, the bridge handles encrypted events currently by
 * listening over the AS stream for encrypted messages, and then spinning
 * up a /sync in order to read the message. In order to decrypt them, we
 * proxy these requests through https://github.com/matrix-org/pantalaimon.
 *
 *   +-------------------+
 *   |  Homeserver       |
 *   +--------+----------+
 *           ^
 *           | Proxy
 *           |
 *           |
 *   +--------+----------+
 *   |  Pantalaimon      |
 *   +--------+----------+
 *           ^ /sync requests
 *           |
 *           |
 *   +--------+----------+
 *   |  Bridge           |
 *   +-------------------+
 *
 * We also gain things like presence, read receipts and typing for free.
 */
export class EncryptedEventBroker {
    constructor(
        private membership: MembershipCache,
        private asBot: AppServiceBot,
        private onEvent: (weakEvent: WeakEvent) => void,
        private onEphemeralEvent: ((event: EphemeralEvent) => void)|undefined,
        private getIntent: (userId: string) => Intent
        ) {
        if (this.onEphemeralEvent) {
            // Only cleanup presence if we're handling it.
            this.presenceCleanupInterval = setInterval(() => {
                const ts = Date.now() - PRESENCE_CACHE_FOR_MS;
                this.receivedPresence = this.receivedPresence.filter(
                    presence => presence.ts < ts
                );
            }, PRESENCE_CACHE_FOR_MS);
        }

    }
    private receivedPresence: DedupePresence[] = [];
    private presenceCleanupInterval: NodeJS.Timeout|undefined;
    private handledEvents = new Set<string>();
    private userForRoom = new Map<string, string>();

    private eventsPendingSync = new Set<string>();
    // We should probably make these LRUs eventually
    private eventsPendingAS: WeakEvent[] = [];

    private syncingClients = new Map<string,any>();

    /**
     * Called when the bridge gets an event through an appservice transaction.
     * @param event
     * @returns Should the event be passthrough
     */
    public async onASEvent(event: WeakEvent) {
        if (event.type === "m.room.member" && event.state_key && event.content.membership) {
            const existingSyncUser = this.userForRoom.get(event.room_id);
            if (existingSyncUser === event.state_key && event.content.membership !== "join") {
                // User has left the room (or are banned/invited), they are no longer our sync targets.
                this.userForRoom.delete(event.room_id);
            }
        }

        if (event.type !== "m.room.encrypted") {
            log.debug(`Ignoring ${event.event_id}, not a encrypted event`);
            // Passthrough directly.
            return true;
        }

        log.debug(`Got AS event ${event.event_id}`);
        this.eventsPendingSync.add(event.event_id);
        const syncedEvent = this.eventsPendingAS.find((syncEvent) => syncEvent.event_id === event.event_id);
        if (syncedEvent) {
            log.debug("Got sync event before AS event");
            this.handleEvent(syncedEvent);
            return false;
        }

        // We need to determine if anyone is syncing for this room?
        const existingUserForRoom = this.userForRoom.get(event.room_id);
        if (existingUserForRoom) {
            log.debug(`${existingUserForRoom} is listening for ${event.event_id}`);
            // XXX: Sometimes the sync stops working, calling this will wake it up.
            await this.startSyncingUser(existingUserForRoom);
            // Someone is listening, no need.
            return false;
        }

        // Do we have any clients in these rooms already.
        let fullRoomMembership = this.membership.getMembersForRoom(event.room_id, "join");
        if (!fullRoomMembership) {
            log.info(`${event.room_id} has no room membership cached`);
            // We have no membership for this room, fetch it.
            await this.asBot.getJoinedMembers(event.room_id);
            // The cache is populated
            fullRoomMembership = this.membership.getMembersForRoom(event.room_id, "join");
            if (!fullRoomMembership) {
                log.error(`${event.room_id} has NO membership after trying to fetch fresh state`);
                // We STILL don't have membership? Doesn't seem likely.
                return false;
            }
        }

        const membersForRoom = fullRoomMembership.filter((u) => this.asBot.isRemoteUser(u));
        if (!membersForRoom.length) {
            log.error(`${event.room_id} has no bridge users in the room`);
            // We have NO clients in this room but we got the event? Seems dodgy.
            return false;
        }

        const existingUser = membersForRoom.find((u) => [...this.userForRoom.values()].includes(u));
        if (existingUser) {
            log.debug(`${event.room_id} will be synced by ${existingUser}`);
            // Bind them to the room
            this.userForRoom.set(event.room_id, existingUser);
        }

        // We have no syncing clients for this room. Take the first one.
        const newSyncer = membersForRoom[0];
        log.debug(`No syncing clients for ${event.room_id}, will use ${newSyncer}`);
        // Wait so that we block before new events arrive.
        await this.getIntent(newSyncer).ensureRegistered();
        await this.startSyncingUser(newSyncer);
        this.userForRoom.set(event.room_id, newSyncer);
        return false;
    }

    private onSyncEvent(event: any) {
        if (!event.event.decrypted) {
            // We only care about encrypted events, and pan appends a decrypted key to each event.
            return;
        }
        if (!this.eventsPendingSync.has(event.getId())) {
            log.debug("Got AS event before sync event");
            // We weren't waiting for this event, but we might have got here too quick.
            this.eventsPendingAS.push(event.event);
            return;
        }
        const key = `${event.getRoomId()}:${event.getId()}`;
        if (this.handledEvents.has(key)) {
            // We're not interested in this event, as it's been handled.
            return;
        }
        this.handleEvent(event.event);
    }

    private handleEvent(event: WeakEvent) {
        // First come, first serve handling.
        this.handledEvents.add(`${event.room_id}:${event.event_id}`);

        log.debug(`Handling ${event.event_id} through sync`);
        this.onEvent(event);

        // Delete the event from the pending list
        this.eventsPendingSync.delete(event.event_id);
        this.eventsPendingAS = this.eventsPendingAS.filter((e) => e.event_id !== event.event_id);
    }

    private onTyping(syncUserId: string, event: any) {
        if (!this.onEphemeralEvent) {
            return;
        }
        if (this.userForRoom.get(event.getRoomId()) === syncUserId) {
            // Ensure only the selected user for the room syncs this.
            this.onEphemeralEvent(event.event);
        }
    }

    private onReceipt(syncUserId: string, event: any) {
        if (!this.onEphemeralEvent) {
            return;
        }
        if (this.userForRoom.get(event.getRoomId()) === syncUserId) {
            // Ensure only the user for the room syncs this.
            this.onEphemeralEvent(event.event);
        }
    }

    private onPresence(event: any) {
        if (!this.onEphemeralEvent) {
            return;
        }
        // Presence needs to be de-duplicated.
        const now = Date.now();
        const presenceEv = event.event as PresenceEvent;
        const presenceContent = presenceEv.content;
        const existingPresence = this.receivedPresence.find((p) =>
            p.currentlyActive === presenceContent.currently_active &&
            p.presence === presenceContent.presence &&
            p.statusMsg === presenceContent.status_msg &&
            p.userId === event.getSender()
        );
        if (existingPresence) {
            // We've handled this already
            return;
        }
        this.receivedPresence.push({
            currentlyActive: presenceContent.currently_active,
            presence: presenceContent.presence,
            statusMsg: presenceContent.status_msg,
            userId: event.getSender(),
            ts: now,
        });
        this.onEphemeralEvent(presenceEv);
    }

    /**
     * Start a sync loop for a given bridge user
     * @param userId The user whos matrix client should start syncing
     */
    public startSyncingUser(userId: string) {
        const intent = this.getIntent(userId);
        const matrixClient = intent.getClient();
        const syncState = matrixClient.getSyncState();
        if (syncState && !["STOPPED", "ERROR"].includes(syncState)) {
            log.debug(`Client is already syncing: ${syncState}`);
            return;
        }
        log.info(`Starting to sync ${userId} (curr: ${syncState})`);
        if (syncState) {
            log.debug(`Cancel existing sync`);
            // Ensure we cancel any existing stuff
            matrixClient.stopClient();
        }
        matrixClient.on("event", this.onSyncEvent.bind(this));
        matrixClient.on("error", (err: Error) => {
            log.error(`${userId} client error:`, err);
        });
        const filter = new Filter(userId);
        filter.setDefinition(SYNC_FILTER);
        if (this.onEphemeralEvent) {
            matrixClient.on("RoomMember.typing", (event: TypingEvent) => this.onTyping(userId, event));
            matrixClient.on("Room.receipt", (event: ReadReceiptEvent) => this.onReceipt(userId, event));
            matrixClient.on("User.presence", (event: PresenceEvent) => this.onPresence(event));
        }
        else {
            filter.definition.presence = {
                // No way to disable presence, so make it filter for an impossible type
                types: ["not.a.real.type"],
                limit: 0,
            };
            filter.definition.room.ephemeral = {
                // No way to disable presence, so make it filter for an impossible type
                types: ["not.a.real.type"],
                limit: 0,
            }
        }
        log.debug(`Starting a new sync for ${userId}`);
        this.syncingClients.set(userId, matrixClient);
        return matrixClient.startClient({
            resolveInvitesToProfiles: false,
            filter,
        });
    }

    public shouldAvoidCull(intent: Intent) {
        // Is user in use for syncing a room?
        if ([...this.userForRoom.values()].includes(intent.userId)) {
            return true;
        }
        // Otherwise, we should cull it. Also stop it from syncing.
        if (this.syncingClients.has(intent.userId)) {
            log.debug(`Stopping sync for ${intent.userId} due to cull`);
            // If we ARE culling the client then ensure they stop syncing too.
            try {
                this.syncingClients.get(intent.userId)?.stopClient();
                this.syncingClients.delete(intent.userId);
            } catch (ex) {
                log.debug(`Failed to cull ${intent.userId}`, ex);
            }
        }
        return false;
    }

    /**
     * Stop syncing clients used for encryption
     */
    public close() {
        for (const client of this.syncingClients.values()) {
            client.stopClient();
        }
        if (this.presenceCleanupInterval) {
            clearInterval(this.presenceCleanupInterval);
        }
    }

    public static supportsLoginFlow(loginFlows: {flows: {type: string}[]}) {
        return loginFlows.flows.find(
            flow => flow.type === APPSERVICE_LOGIN_TYPE
        );
    }
}
