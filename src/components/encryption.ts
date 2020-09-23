import { MembershipCache } from "./membership-cache";
import { AppServiceBot } from "./app-service-bot";
import { WeakEvent } from "./event-types";
import { EphemeralEvent, PresenceEvent, ReadReceiptEvent, TypingEvent } from "./event-types";
import { Intent } from "./intent";
import Logging from "./logging";

// matrix-js-sdk lacks types
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Filter } = require('matrix-js-sdk');

const log = Logging.get("EncryptedEventBroker");

export const APPSERVICE_LOGIN_TYPE = "uk.half-shot.msc2778.login.application_service";

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
    }
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
        private onEphemeralEvent: (event: EphemeralEvent) => void,
        private getIntent: (userId: string) => Intent
        ) {

        this.presenceCleanupInterval = setInterval(() => {
            const ts = Date.now() - 30000;
            this.receivedPresence = this.receivedPresence.filter(
                presence => presence.ts < ts
            );
        }, 15000);
    }
    private receivedPresence: DedupePresence[] = [];
    private presenceCleanupInterval: NodeJS.Timeout;
    private handledEvents = new Set<string>();
    private userForRoom = new Map<string, string>();

    private eventsPendingSync = new Set<string>();
    // We should probably make these LRUs eventually
    private eventsPendingAS: WeakEvent[] = [];

    private syncingClients = new Set<any>();

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
            log.info("Got sync event before AS event");
            this.onEvent(syncedEvent);
            return false;
        }

        // We need to determine if anyone is syncing for this room?
        const existingUserForRoom = this.userForRoom.get(event.room_id);
        if (existingUserForRoom) {
            log.debug(`${existingUserForRoom} is listening for ${event.event_id}`);
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
            log.error(`${event.room_id} will be synced by ${existingUser}`);
            // Bind them to the room
            this.userForRoom.set(event.room_id, existingUser);
        }

        // We have no syncing clients for this room. Take the first one.
        await this.startSyncingUser(membersForRoom[0]);
        return false;
    }

    private onSyncEvent(event: any) {
        if (!event.event.decrypted) {
            // We only care about encrypted events, and pan appends a decrypted key to each event
            // log.debug(`Ignoring ${event.getId()} in sync, not a encrypted event`);DedupePresence
            // Only interested in encrypted events.
            return;
        }
        if (!this.eventsPendingSync.has(event.getId())) {
            log.info("Got AS event before sync event");
            // We weren't waiting for this event, but we might have got here too quick.
            this.eventsPendingAS.push(event.event);
            return;
        }
        const key = `${event.getRoomId()}:${event.getId()}`;
        if (this.handledEvents.has(key)) {
            // We're not interested in this event, as it's been handled.
            return;
        }
        // First come, first serve handling.
        this.handledEvents.add(key);
        log.debug(`Handling ${event.getId()} through sync`);
        this.onEvent(event.event);
    }

    private onTyping(syncUserId: string, event: any) {
        if (this.userForRoom.get(event.getRoomId()) === syncUserId) {
            // Ensure only the selected user for the room syncs this.
            this.onEphemeralEvent(event.event);
        }
    }

    private onReceipt(syncUserId: string, event: any) {
        if (this.userForRoom.get(event.getRoomId()) === syncUserId) {
            // Ensure only the user for the room syncs this.
            this.onEphemeralEvent(event.event);
        }
    }

    private onPresence(event: any) {
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
    public async startSyncingUser(userId: string) {
        log.info(`Starting to sync ${userId}`);
        const intent = this.getIntent(userId);
        await intent.ensureRegistered();
        const matrixClient = intent.getClient();
        matrixClient.on("event", this.onSyncEvent.bind(this));
        matrixClient.on("error", (err: Error) => {
            log.error(`${userId} client error:`, err);
        });
        matrixClient.on("RoomMember.typing", (event: TypingEvent) => this.onTyping(userId, event));
        matrixClient.on("Room.receipt", (event: ReadReceiptEvent) => this.onReceipt(userId, event));
        matrixClient.on("User.presence", (event: PresenceEvent) => this.onPresence(event));
        const filter = new Filter(userId);
        filter.setDefinition(SYNC_FILTER);
        await matrixClient.startClient({
            resolveInvitesToProfiles: false,
            filter,
        });
        this.syncingClients.add(matrixClient);
    }

    /**
     * Stop syncing clients used for encryption
     */
    public close() {
        for (const client of this.syncingClients.values()) {
            client.stopClient();
        }
        clearInterval(this.presenceCleanupInterval);
    }

    public static supportsLoginFlow(loginFlows: {flows: {type: string}[]}) {
        return loginFlows.flows.find(
            flow => flow.type === APPSERVICE_LOGIN_TYPE
        );
    }
}
