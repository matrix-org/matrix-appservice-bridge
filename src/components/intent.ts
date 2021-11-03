/* eslint-disable camelcase */
/*
Copyright 2020 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at
    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { ClientRequestCache } from "./client-request-cache";
import { defer } from "../utils/promiseutil";
import { UserMembership } from "./membership-cache";
import { unstable } from "../errors";
import BridgeErrorReason = unstable.BridgeErrorReason;
import { APPSERVICE_LOGIN_TYPE, ClientEncryptionSession } from "./encryption";
import Logging from "./logging";
import { ReadStream } from "fs";
import BotSdk, { MatrixClient, MatrixProfileInfo, PresenceState } from "matrix-bot-sdk";

const log = Logging.get("Intent");
export type IntentBackingStore = {
    getMembership: (roomId: string, userId: string) => UserMembership,
    getMemberProfile: (roomId: string, userid: string) => MatrixProfileInfo,
    getPowerLevelContent: (roomId: string) => PowerLevelContent | undefined,
    setMembership: (roomId: string, userId: string, membership: UserMembership, profile: MatrixProfileInfo) => void,
    setPowerLevelContent: (roomId: string, content: PowerLevelContent) => void,
};

type OnEventSentHook = (roomId: string, type: string, content: Record<string, unknown>, eventId: string) => void;

export interface IntentOpts {
    backingStore?: IntentBackingStore,
    caching?: {
        ttl?: number,
        size?: number,
    }
    dontCheckPowerLevel?: boolean;
    dontJoin?: boolean;
    enablePresence?: boolean;
    registered?: boolean;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getJsSdkClient?: () => any,
    encryption?: {
        sessionPromise: Promise<ClientEncryptionSession|null>;
        sessionCreatedCallback: (session: ClientEncryptionSession) => Promise<void>;
        ensureClientSyncingCallback: () => Promise<void>;
        origianlHomeserver: string;
    };
    onEventSent?: OnEventSentHook,
}

export interface RoomCreationOpts {
    createAsClient?: boolean;
    options?: Record<string, unknown>;
}

export interface FileUploadOpts {
    name?: string;
    type?: string;
}

const DEFAULT_CACHE_TTL = 90000;
const DEFAULT_CACHE_SIZE = 1024;

export type PowerLevelContent = {
    // eslint-disable-next-line camelcase
    state_default?: unknown;
    // eslint-disable-next-line camelcase
    events_default?: unknown;
    // eslint-disable-next-line camelcase
    users_default?: unknown;
    users?: {
        [userId: string]: unknown;
    },
    events?: {
        [eventType: string]: unknown;
    }
};

type UserProfileKeys = "avatar_url"|"displayname"|null;

export class Intent {

    private static getClientWarningFired = false;

    private _requestCaches: {
        profile: ClientRequestCache<MatrixProfileInfo, [string, UserProfileKeys]>,
        roomstate: ClientRequestCache<unknown, []>,
        event: ClientRequestCache<unknown, [string, string]>
    }
    private opts: {
        backingStore: IntentBackingStore,
        caching: {
            ttl: number,
            size: number,
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        getJsSdkClient?: () => any,
        dontCheckPowerLevel?: boolean;
        dontJoin?: boolean;
        enablePresence: boolean;
        registered?: boolean;
        onEventSent?: OnEventSentHook,
    }
    // These two are only used if no opts.backingStore is provided to the constructor.
    private readonly _membershipStates: Record<string, [UserMembership, MatrixProfileInfo]> = {};
    private readonly _powerLevels: Record<string, PowerLevelContent> = {};
    private readonly encryptedRooms = new Map<string, string|false>();
    private readonly encryption?: {
        sessionPromise: Promise<ClientEncryptionSession|null>;
        sessionCreatedCallback: (session: ClientEncryptionSession) => Promise<void>;
        ensureClientSyncingCallback: () => Promise<void>;
        origianlHomeserver: string
    };
    private encryptionReadyPromise?: Promise<void>;

    // A client that talks directly to the homeserver, bypassing pan.
    private encryptionHsClient?: MatrixClient;

    // The legacyClient is created on demand when bridges need to use
    // it, but is not created by default anymore.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private legacyClient?: any;

    /**
    * Create an entity which can fulfil the intent of a given user.
    * @constructor
    * @param botSdkIntent The bot sdk intent which this intent wraps
    * fulfilled e.g. the entity joining the room when you call intent.join(roomId).
    * @param botClient The client instance for the AS bot itself.
    * This will be used to perform more priveleged actions such as creating new
    * rooms, sending invites, etc.
    * @param opts Options for this Intent instance.
    * @param opts.registered True to inform this instance that the client
    * is already registered. No registration requests will be made from this Intent.
    * Default: false.
    * @param opts.dontCheckPowerLevel True to not check for the right power
    * level before sending events. Default: false.
    *
    * @param opts.backingStore An object with 4 functions, outlined below.
    * If this Object is supplied, ALL 4 functions must be supplied. If this Object
    * is not supplied, the Intent will maintain its own backing store for membership
    * and power levels, which may scale badly for lots of users.
    *
    * @param opts.backingStore.getMembership A function which is called with a
    * room ID and user ID which should return the membership status of this user as
    * a string e.g "join". `null` should be returned if the membership is unknown.
    *
    * @param opts.backingStore.getPowerLevelContent A function which is called
    * with a room ID which should return the power level content for this room, as an Object.
    * `null` should be returned if there is no known content.
    *
    * @param opts.backingStore.setMembership A function with the signature:
    * function(roomId, userId, membership) which will set the membership of the given user in
    * the given room. This has no return value.
    *
    * @param opts.backingStore.setPowerLevelContent A function with the signature:
    * function(roomId, content) which will set the power level content in the given room.
    * This has no return value.
    *
    * @param opts.dontJoin True to not attempt to join a room before
    * sending messages into it. The surrounding code will have to ensure the correct
    * membership state itself in this case. Default: false.
    *
    * @param opts.enablePresence True to send presence, false to no-op.
    *
    * @param opts.caching.ttl How long requests can stay in the cache, in milliseconds.
    * @param opts.caching.size How many entries should be kept in the cache, before the oldest is dropped.
    * @param opts.getJsSdkClient Create a Matrix JS SDK client on demand for legacy code.
    */
    constructor(
        public readonly botSdkIntent: BotSdk.Intent,
        private readonly botClient: BotSdk.MatrixClient,
        opts: IntentOpts = {}) {
        if (opts.backingStore) {
            if (!opts.backingStore.setPowerLevelContent ||
                    !opts.backingStore.getPowerLevelContent ||
                    !opts.backingStore.setMembership ||
                    !opts.backingStore.getMembership) {
                throw new Error("Intent backingStore missing required functions");
            }
        }
        this.encryption = opts.encryption;
        this.opts = {
            ...opts,
            backingStore: opts.backingStore ? { ...opts.backingStore } : {
                getMembership: (roomId: string, userId: string) => {
                    if (userId !== this.userId) {
                        return null;
                    }
                    return this._membershipStates[roomId] && this._membershipStates[roomId][0];
                },
                getMemberProfile: (roomId: string, userId: string) => {
                    if (userId !== this.userId) {
                        return {};
                    }
                    return this._membershipStates[roomId] && this._membershipStates[roomId][1];
                },
                getPowerLevelContent: (roomId: string) => {
                    return this._powerLevels[roomId];
                },
                setMembership: (
                    roomId: string, userId: string, membership: UserMembership, profile: MatrixProfileInfo) => {
                    if (userId !== this.userId) {
                        return;
                    }
                    this._membershipStates[roomId] = [membership, profile];
                },
                setPowerLevelContent: (roomId: string, content: PowerLevelContent) => {
                    this._powerLevels[roomId] = content;
                },
            },
            caching: {
                size: opts.caching?.ttl || DEFAULT_CACHE_SIZE,
                ttl: opts.caching?.ttl || DEFAULT_CACHE_TTL,
            },
            enablePresence: opts.enablePresence !== false,
        };
        this._requestCaches = {
            profile: new ClientRequestCache(
                this.opts.caching.ttl,
                this.opts.caching.size,
                (_: string, userId: string, info: UserProfileKeys) => {
                    return this.getProfileInfo(userId, info, false);
                }
            ),
            roomstate: new ClientRequestCache(
                this.opts.caching.ttl,
                this.opts.caching.size,
                (roomId: string) => {
                    return this.roomState(roomId, false);
                }
            ),
            event: new ClientRequestCache(
                this.opts.caching.ttl,
                this.opts.caching.size,
                (_: string, roomId: string, eventId: string) => {
                    return this.getEvent(roomId, eventId, false);
                }
            ),
        };
    }

    public get matrixClient(): MatrixClient {
        return this.botSdkIntent.underlyingClient;
    }

    /**
     * Legacy property to access the matrix-js-sdk.
     * @deprecated Support for the matrix-js-sdk client will be going away in
     * a future release. Where possible, the intent object functions should be
     * used. The `botSdkIntent` also provides access to the new client.
     * @see getClient
     */
    public get client() {
        return this.getClient();
    }

    /**
     * Return a matrix-js-sdk client, which is created on demand.
     * @deprecated Support for the matrix-js-sdk client will be going away in
     * a future release. Where possible, the intent object functions should be
     * used. The `botSdkIntent` also provides access to the new client.
     * @return The client
     */
    public getClient() {
        if (this.legacyClient) {
            return this.legacyClient;
        }
        if (!this.opts.getJsSdkClient) {
            throw Error('Legacy client not available');
        }
        if (!Intent.getClientWarningFired) {
            console.warn("Support for the matrix-js-sdk will be going away in a future release." +
                    "Please replace usage of Intent.getClient() and Intent.client with either " +
                    "Intent functions, or Intent.matrixClient");
            Intent.getClientWarningFired = true;
        }
        this.legacyClient = this.opts.getJsSdkClient();
        return this.legacyClient;
    }

    public get userId(): string {
        return this.botSdkIntent.userId;
    }

    /**
     * Resolve a roomId or alias into a roomId. If a roomId is given, it is immediately returned.
     * @param roomAliasOrId A roomId or alias to resolve.
     * @throws If the provided string was incorrectly formatted or alias does not exist.
     */
    public async resolveRoom(roomAliasOrId: string): Promise<string> {
        return this.botSdkIntent.underlyingClient.resolveRoom(roomAliasOrId);
    }

    /**
     * Send a plaintext message to a room.
     *
     * This will automatically make the client join the room so they can send the
     * message if they are not already joined. It will also make sure that the client
     * has sufficient power level to do this.
     * @param roomId The room to send to.
     * @param text The text string to send.
     * @returns The Matrix event ID.
     */
    public sendText(roomId: string, text: string): Promise<{event_id: string}> {
        return this.sendMessage(roomId, {
            body: text,
            msgtype: "m.text"
        });
    }

    /**
     * Set the name of a room.
     *
     * This will automatically make the client join the room so they can set the
     * name if they are not already joined. It will also make sure that the client
     * has sufficient power level to do this.
     * @param roomId The room to send to.
     * @param name The room name.
     * @returns The Matrix event ID.
     */
    public async setRoomName(roomId: string, name: string): Promise<{event_id: string}> {
        return this.sendStateEvent(roomId, "m.room.name", "", {
            name: name
        });
    }

    /**
     * Set the topic of a room.
     *
     * This will automatically make the client join the room so they can set the
     * topic if they are not already joined. It will also make sure that the client
     * has sufficient power level to do this.
     * @param roomId The room to send to.
     * @param topic The room topic.
     */
    public async setRoomTopic(roomId: string, topic: string): Promise<{event_id: string}> {
        return this.sendStateEvent(roomId, "m.room.topic", "", {
            topic: topic
        });
    }

    /**
     * Set the avatar of a room.
     *
     * This will automatically make the client join the room so they can set the
     * topic if they are not already joined. It will also make sure that the client
     * has sufficient power level to do this.
     * @param roomId The room to send to.
     * @param avatar The url of the avatar.
     * @param info Extra information about the image. See m.room.avatar for details.
     */
    public setRoomAvatar(roomId: string, avatar: string, info?: string): Promise<{event_id: string}> {
        return this.sendStateEvent(roomId, "m.room.avatar", "", {
            info,
            url: avatar,
        });
    }

    /**
     * Send a typing event to a room.
     *
     * This will automatically make the client join the room so they can send the
     * typing event if they are not already joined.
     * @param roomId The room to send to.
     * @param isTyping True if typing
     */
    public async sendTyping(roomId: string, isTyping: boolean) {
        await this._ensureJoined(roomId);
        return this.botSdkIntent.underlyingClient.setTyping(roomId, isTyping);
    }

    /**
     * Send a read receipt to a room.
     *
     * This will automatically make the client join the room so they can send the
     * receipt event if they are not already joined.
     * @param roomId The room to send to.
     * @param eventId The event ID to set the receipt mark to.
     */
    public async sendReadReceipt(roomId: string, eventId: string) {
        await this._ensureJoined(roomId);
        return this.botSdkIntent.underlyingClient.sendReadReceipt(roomId, eventId);
    }

    /**
     * Set the power level of the given target.
     * @param roomId The room to set the power level in.
     * @param target The target user ID
     * @param level The desired level. Undefined will remove the users custom power level.
     */
    public async setPowerLevel(roomId: string, target: string, level: number|undefined) {
        await this._ensureJoined(roomId);
        const powerLevel: PowerLevelContent = await this.getStateEvent(roomId, "m.room.power_levels", "", true);
        if (powerLevel && level && (powerLevel?.users || {})[target] !== level) {
            powerLevel.users = powerLevel.users || {};
            powerLevel.users[target] = level;
            await this.sendStateEvent(roomId, "m.room.power_levels", "", powerLevel);
        }
        else if (powerLevel?.users && !level) {
            delete powerLevel.users[target];
            await this.sendStateEvent(roomId, "m.room.power_levels", "", powerLevel);
        }
        else if (!powerLevel && level) {
            await this.botSdkIntent.underlyingClient.setUserPowerLevel(target, roomId, level);
        }
        // Otherwise this is a no-op
        log.debug(`Setting PL of ${target} in ${roomId} to ${level} was a no-op`)
    }

    /**
     * Send an `m.room.message` event to a room.
     *
     * This will automatically make the client join the room so they can send the
     * message if they are not already joined. It will also make sure that the client
     * has sufficient power level to do this.
     * @param roomId The room to send to.
     * @param content The event content
     */
    public sendMessage(roomId: string, content: Record<string, unknown>) {
        return this.sendEvent(roomId, "m.room.message", content);
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
        let encrypted = false;
        if (this.encryption) {
            try {
                encrypted = !!(await this.isRoomEncrypted(roomId));
            }
            catch (ex) {
                // This is unexpected. Fail safe.
                log.debug(`Could not determine if room is encrypted. Assuming yes:`, ex);
                encrypted = true;
            }
            if (!this.encryptionHsClient) {
                console.warn(`NO HS CLIENT!!!`);
            }
            if (encrypted) {
                // We *need* to sync before we can send a message to an encrypted room.
                await this.encryption.ensureClientSyncingCallback();
            }
            else if (this.encryptionHsClient) {
                // We want to send the event to the homeserver directly to avoid pan checking for
                // a syncing client.
                const result = {
                    // eslint-disable-next-line camelcase
                    event_id: await this.encryptionHsClient.sendEvent(roomId, type, content),
                };
                this.opts.onEventSent?.(roomId, type, content, result.event_id);
                return result;
            }
        }
        const result = {
            // eslint-disable-next-line camelcase
            event_id: await this.botSdkIntent.underlyingClient.sendEvent(roomId, type, content),
        };
        this.opts.onEventSent?.(roomId, type, content, result.event_id);
        return result;
    }

    /**
     * Send a state event to a room.
     *
     * This will automatically make the client join the room so they can send the
     * state if they are not already joined. It will also make sure that the client
     * has sufficient power level to do this.
     * @param roomId The room to send to.
     * @param type The event type
     * @param skey The state key
     * @param content The event content
     */
    public async sendStateEvent(roomId: string, type: string, skey: string, content: Record<string, unknown>
        // eslint-disable-next-line camelcase
        ): Promise<{event_id: string}> {
        return this._joinGuard(roomId, async() => {
            try {
                return {
                    // eslint-disable-next-line camelcase
                    event_id:  await this.botSdkIntent.underlyingClient.sendStateEvent(roomId, type, skey, content),
                }
            }
            catch (ex) {
                if (ex.body.errcode !== "M_FORBIDDEN") {
                    throw ex;
                }
            }
            await this._ensureHasPowerLevelFor(roomId, type, true);
            return {
                // eslint-disable-next-line camelcase
                event_id: await this.botSdkIntent.underlyingClient.sendStateEvent(roomId, type, skey, content)
            }
        });
    }

    /**
     * Get the current room state for a room.
     *
     * This will automatically make the client join the room so they can get the
     * state if they are not already joined.
     * @param roomId The room to get the state from.
     * @param useCache Should the request attempt to lookup
     * state from the cache.
     */
    public async roomState(roomId: string, useCache=false) {
        await this._ensureJoined(roomId);
        if (useCache) {
            return this._requestCaches.roomstate.get(roomId);
        }
        return this.botSdkIntent.underlyingClient.getRoomState(roomId);
    }

    /**
     * Create a room with a set of options.
     * @param opts Options.
     * @param opts.createAsClient True to create this room as a client and
     * not the bot: the bot will not join. False to create this room as the bot and
     * auto-join the client. Default: false.
     * @param opts.options Options to pass to the client SDK /createRoom API.
     */
    // eslint-disable-next-line camelcase
    public async createRoom(opts: RoomCreationOpts): Promise<{room_id: string}> {
        const cli = opts.createAsClient ? this.botSdkIntent.underlyingClient : this.botClient;
        const options = opts.options || {};
        if (!opts.createAsClient) {
            // invite the client if they aren't already
            options.invite = options.invite || [];
            if (Array.isArray(options.invite) && !options.invite.includes(this.userId)) {
                options.invite.push(this.userId);
            }
        }
        // make sure that the thing doing the room creation isn't inviting itself
        // else Synapse hard fails the operation with M_FORBIDDEN
        if (Array.isArray(options.invite) && options.invite.includes(this.userId)) {
            options.invite.splice(options.invite.indexOf(this.userId), 1);
        }

        await this.ensureRegistered();
        const roomId = await cli.createRoom(options);
        // create a fake power level event to give the room creator ops if we
        // don't yet have a power level event.
        if (this.opts.backingStore.getPowerLevelContent(roomId)) {
            return {room_id: roomId};
        }
        const users: Record<string, number> = {};
        users[this.userId] = 100;
        this.opts.backingStore.setPowerLevelContent(roomId, {
            users_default: 0,
            events_default: 0,
            state_default: 50,
            users: users,
            events: {}
        });
        return {room_id: roomId};
    }

    /**
     * Invite a user to a room.
     *
     * This will automatically make the client join the room so they can send the
     * invite if they are not already joined.
     * @param roomId The room to invite the user to.
     * @param target The user ID to invite.
     * @return Resolved when invited, else rejected with an error.
     */
    public async invite(roomId: string, target: string) {
        await this._ensureJoined(roomId);
        return this.botSdkIntent.underlyingClient.inviteUser(target, roomId);
    }

    /**
     * Kick a user from a room.
     *
     * This will automatically make the client join the room so they can send the
     * kick if they are not already joined.
     * @param roomId The room to kick the user from.
     * @param target The target of the kick operation.
     * @param reason Optional. The reason for the kick.
     * @return Resolved when kickked, else rejected with an error.
     */
    public async kick(roomId: string, target: string, reason?: string) {
        if (target !== this.userId) {
            // Only ensure joined if we are not also the kicker
            await this._ensureJoined(roomId);
        }
        return this.botSdkIntent.underlyingClient.kickUser(target, roomId, reason);
    }

    /**
     * Ban a user from a room.
     *
     * This will automatically make the client join the room so they can send the
     * ban if they are not already joined.
     * @param roomId The room to ban the user from.
     * @param target The target of the ban operation.
     * @param reason Optional. The reason for the ban.
     * @return Resolved when banned, else rejected with an error.
     */
    public async ban(roomId: string, target: string, reason?: string) {
        await this._ensureJoined(roomId);
        return this.botSdkIntent.underlyingClient.banUser(target, roomId, reason);
    }

    /**
     * Unban a user from a room.
     *
     * This will automatically make the client join the room so they can send the
     * unban if they are not already joined.
     * @param roomId The room to unban the user from.
     * @param target The target of the unban operation.
     * @return Resolved when unbanned, else rejected with an error.
     */
    public async unban(roomId: string, target: string) {
        await this._ensureJoined(roomId);
        return this.botSdkIntent.underlyingClient.unbanUser(target, roomId);
    }

    /**
     * Join a room
     *
     * This will automatically send an invite from the bot if it is an invite-only
     * room, which may make the bot attempt to join the room if it isn't already.
     * @param roomIdOrAlias The room ID or room alias to join.
     * @param viaServers The server names to try and join through in
     * addition to those that are automatically chosen.
     */
    public async join(roomIdOrAlias: string, viaServers?: string[]): Promise<string> {
        return this._ensureJoined(roomIdOrAlias, false, viaServers);
    }

    /**
     * Leave a room
     *
     * This will no-op if the user isn't in the room.
     * @param roomId The room to leave.
     * @param reason An optional string to explain why the user left the room.
     */
    public async leave(roomId: string, reason?: string) {
        if (reason) {
            await this.botSdkIntent.ensureRegistered();
            return this.botSdkIntent.underlyingClient.kickUser(this.userId, roomId, reason);
        }
        return this.botSdkIntent.leaveRoom(roomId);
    }

    /**
     * Get a user's profile information
     *
     * @param userId The ID of the user whose profile to return
     * @param info The profile field name to retrieve (e.g. 'displayname'
     * or 'avatar_url'), or null to fetch the entire profile information.
     * @param useCache Should the request attempt to lookup
     * state from the cache.
     * @return A Promise that resolves with the requested user's profile
     * information
     */
    public async getProfileInfo(
        userId: string, info: UserProfileKeys = null, useCache = true): Promise<MatrixProfileInfo> {
        await this.ensureRegistered();
        if (useCache) {
            return this._requestCaches.profile.get(`${userId}`, userId, null);
        }
        const profile: MatrixProfileInfo = await this.botSdkIntent.underlyingClient.getUserProfile(userId);
        if (info === 'avatar_url') {
            return { avatar_url: profile.avatar_url };
        }
        if (info === 'displayname') {
            return { displayname: profile.displayname };
        }
        return profile;
    }

    /**
     * Set the user's display name
     *
     * @param name The new display name
     */
    public async setDisplayName(name: string) {
        await this.ensureRegistered();
        return this.botSdkIntent.underlyingClient.setDisplayName(name);
    }

    /**
     * Set the user's avatar URL
     *
     * @param url The new avatar URL
     */
    public async setAvatarUrl(url: string) {
        await this.ensureRegistered();
        return this.botSdkIntent.underlyingClient.setAvatarUrl(url);
    }

    /**
     * Ensure that the user has the given profile information set. If it does not,
     * set it.
     * @param displayname The displayname to set. Leave undefined to ignore.
     * @param avatarUrl The avatar to set. Leave undefined to ignore.
     */
    public async ensureProfile(displayname?: string, avatarUrl?: string) {
        if (!displayname && !avatarUrl) {
            throw Error('At least one of displayname,avatarUrl must be defined');
        }
        const profile = await this.getProfileInfo(this.userId, null, false);
        if (displayname && profile.displayname !== displayname) {
            await this.setDisplayName(displayname);
        }
        if (avatarUrl && profile.avatar_url !== avatarUrl) {
            await this.setAvatarUrl(avatarUrl);
        }
    }

    public async setRoomUserProfile(roomId: string, profile: MatrixProfileInfo) {
        const currProfile = this.opts.backingStore.getMemberProfile(roomId, this.userId);
        // Compare the user's current profile (from cache) with the profile
        // that is requested.  Only send the state event if something that was
        // requested to change is different from the current value.
        if (("displayname" in profile && currProfile.displayname != profile.displayname) ||
            ("avatar_url" in profile && currProfile.avatar_url != profile.avatar_url)) {
            const content = {
                membership: "join",
                ...currProfile,
                ...profile,
            };
            await this.sendStateEvent(roomId, 'm.room.member', this.userId, content);
        }
    }

    /**
     * Create a new alias mapping.
     * @param alias The room alias to create
     * @param roomId The room ID the alias should point at.
     */
    public async createAlias(alias: string, roomId: string) {
        await this.ensureRegistered();
        return this.botSdkIntent.underlyingClient.createRoomAlias(alias, roomId);
    }

    /**
     * Set the presence of this user.
     * @param presence One of "online", "offline" or "unavailable".
     * @param status_msg The status message to attach.
     * @return Resolves if the presence was set or no-oped, rejects otherwise.
     */
    public async setPresence(presence: PresenceState, statusMsg?: string) {
        if (!this.opts.enablePresence) {
            return undefined;
        }

        await this.ensureRegistered();
        return this.botSdkIntent.underlyingClient.setPresenceStatus(presence, statusMsg);
    }

    /**
     * Signals that an error occured while handling an event by the bridge.
     *
     * **Warning**: This function is unstable and is likely to change pending the outcome
     * of https://github.com/matrix-org/matrix-doc/pull/2162.
     * @param roomID ID of the room in which the error occured.
     * @param eventID ID of the event for which the error occured.
     * @param networkName Name of the bridged network.
     * @param reason The reason why the bridge error occured.
     * @param reason_body A human readable string d
     * @param affectedUsers Array of regex matching all affected users.
     */
    public async unstableSignalBridgeError(
        roomID: string,
        eventID: string,
        networkName: string|undefined,
        reason: BridgeErrorReason,
        affectedUsers: string[],
    ) {
        return this.sendEvent(
            roomID,
            "de.nasnotfound.bridge_error",
            {
                network_name: networkName,
                reason: reason,
                affected_users: affectedUsers,
                "m.relates_to": {
                    rel_type: "m.reference",
                    event_id: eventID,
                },
            }
        );
    }

    /**
     * Get an event in a room.
     * This will automatically make the client join the room so they can get the
     * event if they are not already joined.
     * @param roomId The room to fetch the event from.
     * @param eventId The eventId of the event to fetch.
     * @param useCache Should the request attempt to lookup from the cache.
     * @return Resolves with the content of the event, or rejects if not found.
     */
    public async getEvent(roomId: string, eventId: string, useCache=true) {
        await this.ensureRegistered();
        if (useCache) {
            return this._requestCaches.event.get(`${roomId}:${eventId}`, roomId, eventId);
        }
        return this.botSdkIntent.underlyingClient.getEvent(roomId, eventId);
    }

    /**
     * Get a state event in a room.
     * This will automatically make the client join the room so they can get the
     * state if they are not already joined.
     * @param roomId The room to get the state from.
     * @param eventType The event type to fetch.
     * @param stateKey The state key of the event to fetch.
     * @param returnNull Return null on not found, rather than throwing
     */
    public async getStateEvent(roomId: string, eventType: string, stateKey = "", returnNull = false) {
        await this._ensureJoined(roomId);
        try {
            return await this.botSdkIntent.underlyingClient.getRoomStateEvent(roomId, eventType, stateKey);
        }
        catch (ex) {
            if (ex.body.errcode !== "M_NOT_FOUND" || !returnNull) {
                throw ex;
            }
        }
        return null;
    }

    /**
     * Check if a room is encrypted. If it is, return the algorithm.
     * @param roomId The room ID to be checked
     * @returns The encryption algorithm or false
     */
    public async isRoomEncrypted(roomId: string): Promise<string|false> {
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
                this.encryptedRooms.set(roomId, algo);
                return algo;
            }
            // Return false if missing, not a string or empty.
            return false;
        }
        catch (ex) {
            if (ex.statusCode == 404) {
                this.encryptedRooms.set(roomId, false);
                return false;
            }
            throw ex;
        }
    }

    /**
     * Upload a file to the homeserver.
     * @param content The file contents
     * @param opts Additional options for the upload.
     * @returns A MXC URL pointing to the uploaded data.
     */
    public async uploadContent(content: Buffer|string|ReadStream, opts: FileUploadOpts = {}): Promise<string> {
        await this.ensureRegistered();
        if (this.encryption) {
            // Media is encrypted, since we don't know the destination room assume this media will be encrypted.
            await this.encryption.ensureClientSyncingCallback();
        }
        let buffer: Buffer;
        if (typeof content === "string") {
            buffer = Buffer.from(content, "utf8");
        }
        else if (content instanceof ReadStream) {
            buffer = Buffer.from(content);
        }
        else {
            buffer = content;
        }
        return this.botSdkIntent.underlyingClient.uploadContent(
            buffer,
            opts.type,
            opts.name,
        );
    }

    /**
     * Set the visibility of a room in the homeserver's room directory.
     * @param roomId The room
     * @param visibility Should the room be visible
     */
    public async setRoomDirectoryVisibility(roomId: string, visibility: "public"|"private") {
        await this.ensureRegistered();
        return this.botSdkIntent.underlyingClient.setDirectoryVisibility(roomId, visibility);
    }

    /**
     * Set the visibility of a room in the appservice's room directory.
     * This only works if you have defined the `protocol` in the registration file.
     * @param roomId The room
     * @param networkId The network (not protocol) that owns this room. E.g. "freenode" (for an IRC bridge)
     * @param visibility Should the room be visible
     */
    public async setRoomDirectoryVisibilityAppService(roomId: string, networkId: string,
        visibility: "public"|"private") {
        await this.ensureRegistered();
        // XXX: No function for this yet.
        return this.client.setRoomDirectoryVisibilityAppService(roomId, visibility, networkId);
    }

    /**
     * Inform this Intent class of an incoming event. Various optimisations will be
     * done if this is provided. For example, a /join request won't be sent out if
     * it knows you've already been joined to the room. This function does nothing
     * if a backing store was provided to the Intent.
     * @param event The incoming event JSON
     */
    public onEvent(event: {
        type: string,
        // eslint-disable-next-line camelcase
        content: {membership: UserMembership, displayname?: string, avatar_url?: string, algorithm?: string},
        // eslint-disable-next-line camelcase
        state_key: unknown,
        // eslint-disable-next-line camelcase
        room_id: string
    }) {
        if (event.state_key === undefined) {
            // We MUST operate on state events exclusively
            return;
        }
        // Invalidate the state cache if anything changes in the state.
        this._requestCaches.roomstate.invalidate(event.room_id);
        if (!this._membershipStates || !this._powerLevels) {
            return;
        }

        if (event.type === "m.room.member" &&
                event.state_key === this.userId &&
                event.content.membership) {
            const profile: MatrixProfileInfo = {};
            if (event.content.displayname) {
                profile.displayname = event.content.displayname;
            }
            if (event.content.avatar_url) {
                profile.avatar_url = event.content.avatar_url;
            }
            this._membershipStates[event.room_id] = [event.content.membership, profile];
        }
        else if (event.type === "m.room.power_levels") {
            this.opts.backingStore.setPowerLevelContent(event.room_id, event.content as unknown as PowerLevelContent);
        }
        else if (event.type === "m.room.encryption" && typeof event.content.algorithm === "string") {
            log.info(`Room ${event.room_id} enabled encryption (${event.content.algorithm})`);
            this.encryptedRooms.set(event.room_id, event.content.algorithm);
        }
    }

    // Guard a function which returns a promise which may reject if the user is not
    // in the room. If the promise rejects, join the room and retry the function.
    private async _joinGuard<T>(roomId: string, promiseFn: () => Promise<T>): Promise<T> {
        try {
            // await so we can handle the error
            return await promiseFn();
        }
        catch (err) {
            if (err.body?.errcode !== "M_FORBIDDEN") {
                // not a guardable error
                throw err;
            }
            await this._ensureJoined(roomId, true);
            return promiseFn();
        }
    }

    private async _ensureJoined(
        roomIdOrAlias: string, ignoreCache = false, viaServers?: string[], passthroughError = false
    ): Promise<string> {
        const opts: { viaServers?: string[] } = { };
        if (viaServers) {
            opts.viaServers = viaServers;
        }
        // Resolve the alias
        const roomId = await this.resolveRoom(roomIdOrAlias);
        if (!ignoreCache && this.opts.backingStore.getMembership(roomId, this.userId) === "join") {
            return roomId;
        }

        /* Logic:
            if client /join:
                SUCCESS
            else if bot /invite client:
                if client /join:
                    SUCCESS
                else:
                    FAIL (client couldn't join)
            else if bot /join:
                if bot /invite client and client /join:
                    SUCCESS
                else:
                    FAIL (bot couldn't invite)
            else:
                FAIL (bot can't get into the room)
        */

        const deferredPromise = defer<string>();

        const mark = (room: string, state: UserMembership) => {
            this.opts.backingStore.setMembership(room, this.userId, state, {});
            if (state === "join") {
                deferredPromise.resolve(room);
            }
        }

        const dontJoin = this.opts.dontJoin;

        try {
            await this.ensureRegistered();
            if (dontJoin) {
                deferredPromise.resolve(roomId);
                return deferredPromise.promise;
            }
            try {
                await this.botSdkIntent.underlyingClient.joinRoom(roomId, opts.viaServers);
                mark(roomId, "join");
            }
            catch (ex) {
                if (ex.body.errcode !== "M_FORBIDDEN") {
                    throw ex;
                }
                try {
                    // Try bot inviting client
                    await this.botClient.inviteUser(this.userId, roomIdOrAlias);
                    await this.botClient.joinRoom(roomId, opts.viaServers);
                    mark(roomId, "join");
                }
                catch (_ex) {
                    // Try bot joining
                    await this.botClient.joinRoom(roomId, opts.viaServers);
                    await this.botClient.inviteUser(this.userId, roomId);
                    await this.botSdkIntent.underlyingClient.joinRoom(roomId, opts.viaServers);
                    mark(roomId, "join");
                }
            }
        }
        catch (ex) {
            deferredPromise.reject(passthroughError ? ex : Error("Failed to join room"));
        }

        return deferredPromise.promise;
    }

    /**
     * Ensures that the client has the required power level to post the event type.
     * @param roomId Required as power levels exist inside a room.
     * @param eventTypes The event type to check the permissions for.
     * @param isState Are we checking for state permissions or regular event permissions.
     * @return If found, the power level event
     */
    private async _ensureHasPowerLevelFor(roomId: string, eventType: string, isState: boolean) {
        if (this.opts.dontCheckPowerLevel && eventType !== "m.room.power_levels") {
            return undefined;
        }
        const userId = this.userId;
        const plContent = this.opts.backingStore.getPowerLevelContent(roomId)
            || await this.botSdkIntent.underlyingClient.getRoomStateEvent(roomId, "m.room.power_levels", "");
        const eventContent: PowerLevelContent = plContent && typeof plContent === "object" ? plContent : {};
        this.opts.backingStore.setPowerLevelContent(roomId, eventContent);

        // Borrowed from https://github.com/turt2live/matrix-bot-sdk/blob/master/src/MatrixClient.ts#L1147
        // We're using our own version for caching.
        let requiredPower: number = isState ? 50 : 0;
        if (isState && typeof eventContent.state_default === "number") {
            requiredPower = eventContent.state_default
        }
        if (!isState && typeof eventContent.users_default === "number") {
            requiredPower = eventContent.users_default;
        }
        if (typeof eventContent.events?.[eventType] === "number") {
            requiredPower = eventContent.events[eventType] as number;
        }

        let userPower = 0;
        if (typeof eventContent.users?.[userId] === "number") {
            userPower = eventContent.users[userId] as number;
        }
        if (requiredPower > userPower) {
            const botUserId = await this.botClient.getUserId();
            let botPower = 0;
            if (typeof eventContent.users?.[botUserId] === "number") {
                botPower = eventContent.users[botUserId] as number;
            }

            let requiredPowerPowerLevels = 50;
            if (typeof eventContent.state_default === "number") {
                requiredPowerPowerLevels = eventContent.state_default
            }
            if (typeof eventContent.events?.[eventType] === "number") {
                requiredPower = eventContent.events[eventType] as number;
            }

            if (requiredPowerPowerLevels > botPower) {
                // even the bot has no power here.. give up.
                throw new Error(
                    `Cannot ensure client has power level for event ${eventType} ` +
                    `: client has ${userPower} and we require ` +
                    `${requiredPower} and the bot doesn't have permission to ` +
                    `edit the client's power level.`
                );
            }
            // TODO: This might be inefficent.
            // update the client's power level first
            await this.botClient.setUserPowerLevel(
                userId, roomId, requiredPower
            );
            // tweak the level for the client to reflect the new reality
            eventContent.users = {
                ...eventContent.users,
                [userId]: requiredPower,
            };
        }
        return eventContent;
    }

    private async loginForEncryptedClient() {
        const userId: string = this.userId;
        const res = await this.botSdkIntent.underlyingClient.doRequest(
            "POST",
            "/_matrix/client/r0/login",
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
        log.debug(`Checking if user ${this.userId} is registered`);
        // We want to skip if and only if all of these conditions are met.
        // Calling /register twice isn't disasterous, but not calling it *at all* IS.
        if (!forceRegister && this.opts.registered && !this.encryption) {
            log.debug("ensureRegistered: Registered, and not encrypted");
            return "registered=true";
        }

        let registerRes;
        if (forceRegister || !this.opts.registered) {
            try {
                registerRes = await this.botSdkIntent.ensureRegistered();
                this.opts.registered = true;
            }
            catch (err) {
                if (err.body?.errcode === "M_EXCLUSIVE" && this.botClient === this.botSdkIntent.underlyingClient) {
                    // Registering the bot will leave it
                    this.opts.registered = true;
                }
                else if (err.body?.errcode === "M_USER_IN_USE") {
                    this.opts.registered = true;
                }
                else {
                    throw err;
                }
            }
        }

        // NOTES:
        // Still seeing errors about invalid access tokens.
        // Still seeing the server attempt to send stuff to pan without sync being enabled.

        if (!this.encryption) {
            log.debug("ensureRegistered: Registered, and not encrypted");
            // We don't care about encryption, or the encryption is ready.
            return registerRes;
        }

        // Past this point, we're an encryption enabled Intent.
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

    private async getEncryptedSession(): Promise<void> {
        if (!this.encryption) {
            throw Error('Cannot call getEncryptedSession without enabling encryption');
        }
        // We've not got a session so let's see if the store has one.
        let session = await this.encryption.sessionPromise;

        if (session) {
            // Store has a session, check we're authenticted.
            log.debug("ensureRegistered: Existing enc session, reusing");
            try {
                const tempClient = new MatrixClient(
                    this.botSdkIntent.underlyingClient.homeserverUrl, session.accessToken
                );
                await tempClient.getWhoAmI();
            }
            catch (ex) {
                log.warn(`Session was invalid for ${this.userId}, generating a new session`);
                session = null;
            }
        }

        if (!session) {
            // No session in the store, attempt a login.
            log.debug("ensureRegistered: Attempting encrypted login");
            // Login as the user
            const result = await this.loginForEncryptedClient();
            session = {
                userId: this.userId,
                ...result,
                syncToken: null,
            };
            log.info(`Created new encrypted session for ${this.userId}`);
            this.encryption.sessionPromise = Promise.resolve(session);
            await this.encryption?.sessionCreatedCallback(session);
        }

        // We still need a direct client to the homeserver in some cases, so clone
        // the existing one.
        const underlyingClient = this.botSdkIntent.underlyingClient;
        this.encryptionHsClient = new MatrixClient(this.encryption.origianlHomeserver, underlyingClient.accessToken);
        this.encryptionHsClient.impersonateUserId(this.userId);
        // We need to overwrite the access token here, as we don't want to use the
        // appservice token but rather a token specific to this user.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (underlyingClient as any).accessToken = session.accessToken;
        this.botSdkIntent.underlyingClient.storageProvider.setSyncToken(session.syncToken);
    }
}
