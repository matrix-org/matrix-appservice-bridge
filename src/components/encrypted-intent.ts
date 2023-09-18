import { APPSERVICE_LOGIN_TYPE, ClientEncryptionSession } from "./encryption";
import { Logger } from "..";
import BotSdk, { MatrixClient, MatrixError } from "@vector-im/matrix-bot-sdk";
import { FileUploadOpts, Intent, IntentOpts } from "./intent";
import { WeakStateEvent } from "./event-types";

const log = new Logger("EncryptedIntent");

export interface EncryptedIntentOpts {
    sessionPromise: Promise<ClientEncryptionSession|null>;
    sessionCreatedCallback: (session: ClientEncryptionSession) => Promise<void>;
    ensureClientSyncingCallback: () => Promise<void>;
    originalHomeserverUrl: string;
}

/**
 * Implements some special handling on top of Intent to handle encrypted rooms.
 */
export class EncryptedIntent extends Intent {

    private readonly encryptedRooms = new Map<string, boolean>();
    private encryptionReadyPromise?: Promise<void>;
    // A client that talks directly to the homeserver, bypassing pantalaimon.
    private encryptionHsClient: MatrixClient;

    constructor(
        botSdkIntent: BotSdk.Intent,
        botClient: BotSdk.MatrixClient,
        intentOpts: IntentOpts, private encryptionOpts: EncryptedIntentOpts) {
        super(botSdkIntent, botClient, intentOpts);

        // We still need a direct client to the homeserver in some cases, so clone
        // the existing one.
        this.encryptionHsClient = new MatrixClient(
            this.encryptionOpts.originalHomeserverUrl,
            this.botSdkIntent.underlyingClient.accessToken
        );
        this.encryptionHsClient.impersonateUserId(this.userId);
    }

    /**
     * Upload a file to the homeserver.
     * @param content The file contents
     * @param opts Additional options for the upload.
     * @returns A MXC URL pointing to the uploaded data.
     */
    public async uploadContent(content: Buffer|string, opts: FileUploadOpts = {}): Promise<string> {
        await this.ensureRegistered();
        // Media is encrypted, since we don't know the destination room assume this media will be encrypted.
        await this.encryptionOpts.ensureClientSyncingCallback();
        return super.uploadContent(content, opts);
    }

    public onEvent(event: WeakStateEvent): void {
        super.onEvent(event);
        if (event.type === "m.room.encryption" && typeof event.content.algorithm === "string") {
            log.info(`Room ${event.room_id} enabled encryption (${event.content.algorithm})`);
            this.encryptedRooms.set(event.room_id, true);
        }
    }

    private async loginForEncryptedClient() {
        const userId: string = this.userId;
        const res = await this.botSdkIntent.underlyingClient.doRequest(
            "POST",
            "/_matrix/client/v3/login",
            undefined,
            {
                type: APPSERVICE_LOGIN_TYPE,
                identifier: {
                    type: "m.id.user",
                    user: userId,
                }
            },
        );
        return {
            accessToken: res.access_token as string,
            deviceId: res.device_id as string,
        };
    }

    public async ensureRegistered(forceRegister = false): Promise<"registered=true"|undefined> {
        super.ensureRegistered(forceRegister);

        if (!this.encryptionReadyPromise) {
            this.encryptionReadyPromise = this.getEncryptedSession();
        }

        // We're already trying to generate a new session.
        try {
            // Should fall through and find the session.
            await this.encryptionReadyPromise;
            // Session ready!
            return "registered=true";
        }
        catch (ex) {
            log.warn("ensureRegistered: failed to ready encryption", ex);
            throw Error('Failed to ready encryption');
            // Failed to ready up - fall through and try again.
        }
    }

    /**
     * Get an encrypted session, either by resolving the `encryption.sessionPromise`
     * promise or creating a new session by logging in to the homeserver.
     */
    private async getEncryptedSession(): Promise<void> {
        // First, see if this user already has a session in the store.
        let session = await this.encryptionOpts.sessionPromise;

        if (session) {
            // Store has a session, check we're authenticted.
            log.debug("getEncryptedSession: Existing session, reusing");
            try {
                const tempClient = new MatrixClient(
                    this.botSdkIntent.underlyingClient.homeserverUrl, session.accessToken
                );
                // Check that the access token works, any failures should be treated as a no.
                await tempClient.getWhoAmI();
            }
            catch (ex) {
                log.warn(`Session was invalid for ${this.userId}, generating a new session`);
                session = null;
            }
        }

        if (!session) {
            // No session in the store, attempt a login.
            log.debug("getEncryptedSession: Attempting login");
            const result = await this.loginForEncryptedClient();
            session = {
                userId: this.userId,
                ...result,
                syncToken: null,
            };
            log.info(`getEncryptedSession: Created new session for ${this.userId}`);
            this.encryptionOpts.sessionPromise = Promise.resolve(session);
            await this.encryptionOpts?.sessionCreatedCallback(session);
        }

        // We need to overwrite the access token here, as we don't want to use the
        // appservice token but rather a token specific to this user.
        const underlyingClient = this.botSdkIntent.underlyingClient;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (underlyingClient as any).accessToken = session.accessToken;
        this.botSdkIntent.underlyingClient.storageProvider.setSyncToken(session.syncToken);
    }

    /**
     * Send a message event to a room.
     *
     * This will automatically make the client join the room so they can send the
     * message if they are not already joined. It will also make sure that the client
     * has sufficient power level to do this.
     * @param roomId The room to send to.
     * @param type The event type
     * @param content The event content
     */
    public async sendEvent(roomId: string, type: string, content: Record<string, unknown>)
         // eslint-disable-next-line camelcase
         : Promise<{event_id: string}> {

         await this.ensureRegistered();
         await this._ensureJoined(roomId);
         await this._ensureHasPowerLevelFor(roomId, type, false);
         let encrypted = false; // Is the room encrypted.
         let client = this.botSdkIntent.underlyingClient;

        try {
            encrypted = !!(await this.isRoomEncrypted(roomId));
        }
        catch (ex) {
            // This is unexpected. Fail safe.
            log.debug(`Could not determine if room is encrypted. Assuming yes:`, ex);
            encrypted = true;
        }
        if (encrypted) {
            // We *need* to sync before we can send a message to an encrypted room, because pantalaimon
            // requires it.
            await this.encryptionOpts.ensureClientSyncingCallback();
        }
        else if (this.encryptionHsClient) {
            // We want to send the event to the homeserver directly to avoid pantalaimon. Pantalaimon
            // always requires the sending client to be syncing, even for non-encrypted rooms.
            // We don't want to always sync to unencrypted rooms because it's expensive.
            client = this.encryptionHsClient;
        }

         const eventId = await super._joinGuard(roomId, () => client.sendEvent(roomId, type, content));
         this.opts.onEventSent?.(roomId, type, content, eventId);
         return {event_id: eventId};
     }


    /**
     * Check if a room is encrypted. If it is, return the algorithm.
     * @param roomId The room ID to be checked
     * @returns The encryption algorithm or false
     */
    public async isRoomEncrypted(roomId: string): Promise<boolean> {
        const existing = this.encryptedRooms.get(roomId);
        if (existing !== undefined) {
            return existing;
        }
        try {
            const ev = await this.getStateEvent(roomId, "m.room.encryption", "", true);
            if (ev === null) {
                this.encryptedRooms.set(roomId, false);
                return false;
            }
            const algo = ev.algorithm as unknown;
            if (typeof algo === 'string' && algo) {
                this.encryptedRooms.set(roomId, true);
                return true;
            }
            // Return false if missing, not a string or empty.
            return false;
        }
        catch (ex) {
            if (ex instanceof MatrixError && ex.statusCode === 404) {
                this.encryptedRooms.set(roomId, false);
                return false;
            }
            throw ex;
        }
    }
}
