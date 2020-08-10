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

import MatrixUser from "../models/users/matrix";
import JsSdk from "matrix-js-sdk";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { MatrixEvent, RoomMember } = JsSdk as any;
import ClientRequestCache from "./client-request-cache";
import { defer } from "../utils/promiseutil";


type BridgeErrorReason = "m.event_not_handled" | "m.event_too_old"
    | "m.internal_error" | "m.foreign_network_error" | "m.event_unknown";

type MembershipState = "join" | "invite" | "leave" | null; // null = unknown

interface IntentOpts {
    backingStore?: {
        getMembership: (roomId: string, userId: string) => MembershipState,
        getPowerLevelContent: (roomId: string) => PowerLevelContent,
        setMembership: (roomId: string, userId: string, membership: MembershipState) => void,
        setPowerLevelContent: (roomId: string, content: PowerLevelContent) => void,
    },
    caching?: {
        ttl?: number,
        size?: number,
    }
    dontCheckPowerLevel?: boolean;
    dontJoin?: boolean;
    enablePresence?: boolean;
    registered?: boolean;
}

const STATE_EVENT_TYPES = [
    "m.room.name", "m.room.topic", "m.room.power_levels", "m.room.member",
    "m.room.join_rules", "m.room.history_visibility"
];
const DEFAULT_CACHE_TTL = 90000;
const DEFAULT_CACHE_SIZE = 1024;

type PowerLevelContent = {
    // eslint-disable-next-line camelcase
    state_default: number;
    // eslint-disable-next-line camelcase
    events_default: number;
    // eslint-disable-next-line camelcase
    users_default: number;
    users: {
        [userId: string]: number;
    },
    events: {
        [eventType: string]: number;
    }
};

export class Intent {
    private _requestCaches: {
        profile: ClientRequestCache,
        roomstate: ClientRequestCache,
        event: ClientRequestCache
    }
    private opts: {
        backingStore: {
            getMembership: (roomId: string, userId: string) => MembershipState,
            getPowerLevelContent: (roomId: string) => PowerLevelContent,
            setMembership: (roomId: string, userId: string, membership: MembershipState) => void,
            setPowerLevelContent: (roomId: string, content: PowerLevelContent) => void,
        },
        caching: {
            ttl: number,
            size: number,
        };
        dontCheckPowerLevel?: boolean;
        dontJoin?: boolean;
        enablePresence: boolean;
        registered?: boolean;
    }
    // These two are only used if no opts.backingStore is provided to the constructor.
    private readonly _membershipStates: Record<string, MembershipState> = {};
    private readonly _powerLevels: Record<string, PowerLevelContent> = {};

    /**
    * Create an entity which can fulfil the intent of a given user.
    * @constructor
    * @param client The matrix client instance whose intent is being
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
    */
    constructor(public readonly client: any, private readonly botClient: any, opts: IntentOpts = {}) {
        if (opts.backingStore) {
            if (!opts.backingStore.setPowerLevelContent ||
                    !opts.backingStore.getPowerLevelContent ||
                    !opts.backingStore.setMembership ||
                    !opts.backingStore.getMembership) {
                throw new Error("Intent backingStore missing required functions");
            }
        }
        this.opts = {
            ...opts,
            backingStore: opts.backingStore ? { ...opts.backingStore } : {
                getMembership: (roomId: string, userId: string) => {
                    if (userId !== this.client.credentials.userId) {
                        return null;
                    }
                    return this._membershipStates[roomId];
                },
                getPowerLevelContent: (roomId: string) => {
                    return this._powerLevels[roomId];
                },
                setMembership: (roomId: string, userId: string, membership: MembershipState) => {
                    if (userId !== this.client.credentials.userId) {
                        return;
                    }
                    this._membershipStates[roomId] = membership;
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
                (_: unknown, userId: string, info: string) => {
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
                (_: unknown, roomId: string, eventId: string) => {
                    return this.getEvent(roomId, eventId, false);
                }
            ),
        };
    }

    /**
     * Return the client this Intent is acting on behalf of.
     * @return The client
     */
    public getClient() {
        return this.client;
    }

    /**
     * <p>Send a plaintext message to a room.</p>
     * This will automatically make the client join the room so they can send the
     * message if they are not already joined. It will also make sure that the client
     * has sufficient power level to do this.
     * @param roomId The room to send to.
     * @param text The text string to send.
     */
    public sendText(roomId: string, text: string) {
        return this.sendMessage(roomId, {
            body: text,
            msgtype: "m.text"
        });
    }

    /**
     * <p>Set the name of a room.</p>
     * This will automatically make the client join the room so they can set the
     * name if they are not already joined. It will also make sure that the client
     * has sufficient power level to do this.
     * @param roomId The room to send to.
     * @param name The room name.
     */
    public setRoomName(roomId: string, name: string) {
        return this.sendStateEvent(roomId, "m.room.name", "", {
            name: name
        });
    }

    /**
     * <p>Set the topic of a room.</p>
     * This will automatically make the client join the room so they can set the
     * topic if they are not already joined. It will also make sure that the client
     * has sufficient power level to do this.
     * @param roomId The room to send to.
     * @param topic The room topic.
     */
    public setRoomTopic(roomId: string, topic: string) {
        return this.sendStateEvent(roomId, "m.room.topic", "", {
            topic: topic
        });
    }

    /**
     * <p>Set the avatar of a room.</p>
     * This will automatically make the client join the room so they can set the
     * topic if they are not already joined. It will also make sure that the client
     * has sufficient power level to do this.
     * @param roomId The room to send to.
     * @param avatar The url of the avatar.
     * @param info Extra information about the image. See m.room.avatar for details.
     */
    public setRoomAvatar(roomId: string, avatar: string, info?: string) {
        const content = {
            info,
            url: avatar,
        };
        return this.sendStateEvent(roomId, "m.room.avatar", "", content);
    }

    /**
     * <p>Send a typing event to a room.</p>
     * This will automatically make the client join the room so they can send the
     * typing event if they are not already joined.
     * @param roomId The room to send to.
     * @param isTyping True if typing
     */
    public async sendTyping(roomId: string, isTyping: boolean) {
        await this._ensureJoined(roomId);
        await this._ensureHasPowerLevelFor(roomId, "m.typing");
        return this.client.sendTyping(roomId, isTyping);
    }

    /**
     * <p>Send a read receipt to a room.</p>
     * This will automatically make the client join the room so they can send the
     * receipt event if they are not already joined.
     * @param roomId The room to send to.
     * @param eventId The event ID to set the receipt mark to.
     */
    public async sendReadReceipt(roomId: string, eventId: string) {
        const event = new MatrixEvent({
            room_id: roomId,
            event_id: eventId,
        });
        await this._ensureJoined(roomId);
        return this.client.sendReadReceipt(event);
    }

    /**
     * Set the power level of the given target.
     * @param roomId The room to set the power level in.
     * @param target The target user ID
     * @param level The desired level. Undefined will remove the users custom power level.
     */
    public async setPowerLevel(roomId: string, target: string, level: number|undefined) {
        await this._ensureJoined(roomId);
        const event = await this._ensureHasPowerLevelFor(roomId, "m.room.power_levels");
        return this.client.setPowerLevel(roomId, target, level, event);
    }

    /**
     * <p>Send an <code>m.room.message</code> event to a room.</p>
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
     * <p>Send a message event to a room.</p>
     * This will automatically make the client join the room so they can send the
     * message if they are not already joined. It will also make sure that the client
     * has sufficient power level to do this.
     * @param roomId The room to send to.
     * @param type The event type
     * @param content The event content
     */
    public async sendEvent(roomId: string, type: string, content: Record<string, unknown>) {
        await this._ensureJoined(roomId);
        await this._ensureHasPowerLevelFor(roomId, type);
        return this._joinGuard(roomId, async() => (
            this.client.sendEvent(roomId, type, content)
        ));
    }

    /**
     * <p>Send a state event to a room.</p>
     * This will automatically make the client join the room so they can send the
     * state if they are not already joined. It will also make sure that the client
     * has sufficient power level to do this.
     * @param roomId The room to send to.
     * @param type The event type
     * @param skey The state key
     * @param content The event content
     */
    public async sendStateEvent(roomId: string, type: string, skey: string, content: Record<string, unknown>) {
        await this._ensureJoined(roomId);
        await this._ensureHasPowerLevelFor(roomId, type);
        return this._joinGuard(roomId, async() => (
            this.client.sendStateEvent(roomId, type, content, skey)
        ));
    }

    /**
     * <p>Get the current room state for a room.</p>
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
        return this.client.roomState(roomId);
    }

    /**
     * Create a room with a set of options.
     * @param opts Options.
     * @param opts.createAsClient True to create this room as a client and
     * not the bot: the bot will not join. False to create this room as the bot and
     * auto-join the client. Default: false.
     * @param opts.options Options to pass to the client SDK /createRoom API.
     */
    public async createRoom(opts: { createAsClient?: boolean, options: Record<string, unknown>}) {
        const cli = opts.createAsClient ? this.client : this.botClient;
        const options = opts.options || {};
        if (!opts.createAsClient) {
            // invite the client if they aren't already
            options.invite = options.invite || [];
            if (Array.isArray(options.invite) && !options.invite.includes(this.client.credentials.userId)) {
                options.invite.push(this.client.credentials.userId);
            }
        }
        // make sure that the thing doing the room creation isn't inviting itself
        // else Synapse hard fails the operation with M_FORBIDDEN
        if (Array.isArray(options.invite) && options.invite.includes(cli.credentials.userId)) {
            options.invite.splice(options.invite.indexOf(cli.credentials.userId), 1);
        }

        await this._ensureRegistered();
        const res = await cli.createRoom(options);
        if (typeof res !== "object" || !res) {
            const type = res === null ? "null" : typeof res;
            throw Error(`Expected Matrix Server to answer createRoom with an object, got ${type}.`);
        }
        const roomId = (res as Record<string, unknown>).room_id;
        if (typeof roomId !== "string") {
            const type = typeof roomId;
            throw Error(`Expected Matrix Server to answer createRoom with a room_id that is a string, got ${type}.`);
        }
        // create a fake power level event to give the room creator ops if we
        // don't yet have a power level event.
        if (this.opts.backingStore.getPowerLevelContent(roomId)) {
            return res;
        }
        const users: Record<string, number> = {};
        users[cli.credentials.userId] = 100;
        this.opts.backingStore.setPowerLevelContent(roomId, {
            users_default: 0,
            events_default: 0,
            state_default: 50,
            users: users,
            events: {}
        });
        return res;
    }

    /**
     * <p>Invite a user to a room.</p>
     * This will automatically make the client join the room so they can send the
     * invite if they are not already joined.
     * @param roomId The room to invite the user to.
     * @param target The user ID to invite.
     * @return Resolved when invited, else rejected with an error.
     */
    public async invite(roomId: string, target: string) {
        await this._ensureJoined(roomId);
        return this.client.invite(roomId, target);
    }

    /**
     * <p>Kick a user from a room.</p>
     * This will automatically make the client join the room so they can send the
     * kick if they are not already joined.
     * @param roomId The room to kick the user from.
     * @param target The target of the kick operation.
     * @param reason Optional. The reason for the kick.
     * @return Resolved when kickked, else rejected with an error.
     */
    public async kick(roomId: string, target: string, reason?: string) {
        await this._ensureJoined(roomId);
        return this.client.kick(roomId, target, reason);
    }

    /**
     * <p>Ban a user from a room.</p>
     * This will automatically make the client join the room so they can send the
     * ban if they are not already joined.
     * @param roomId The room to ban the user from.
     * @param target The target of the ban operation.
     * @param reason Optional. The reason for the ban.
     * @return Resolved when banned, else rejected with an error.
     */
    public async ban(roomId: string, target: string, reason?: string) {
        await this._ensureJoined(roomId);
        return this.client.ban(roomId, target, reason);
    }

    /**
     * <p>Unban a user from a room.</p>
     * This will automatically make the client join the room so they can send the
     * unban if they are not already joined.
     * @param roomId The room to unban the user from.
     * @param target The target of the unban operation.
     * @return Resolved when unbanned, else rejected with an error.
     */
    public async unban(roomId: string, target: string) {
        await this._ensureJoined(roomId);
        return this.client.unban(roomId, target);
    }

    /**
     * <p>Join a room</p>
     * This will automatically send an invite from the bot if it is an invite-only
     * room, which may make the bot attempt to join the room if it isn't already.
     * @param roomId The room to join.
     * @param viaServers The server names to try and join through in
     * addition to those that are automatically chosen.
     */
    public async join(roomId: string, viaServers?: string[]) {
        await this._ensureJoined(roomId, false, viaServers);
    }

    /**
     * <p>Leave a room</p>
     * This will no-op if the user isn't in the room.
     * @param roomId The room to leave.
     */
    public async leave(roomId: string) {
        return this.client.leave(roomId);
    }

    /**
     * <p>Get a user's profile information</p>
     * @param userId The ID of the user whose profile to return
     * @param info The profile field name to retrieve (e.g. 'displayname'
     * or 'avatar_url'), or null to fetch the entire profile information.
     * @param useCache Should the request attempt to lookup
     * state from the cache.
     * @return A Promise that resolves with the requested user's profile
     * information
     */
    public async getProfileInfo(userId: string, info: string, useCache=true) {
        await this._ensureRegistered();
        if (useCache) {
            return this._requestCaches.profile.get(`${userId}:${info}`, userId, info);
        }
        return this.client.getProfileInfo(userId, info);
    }

    /**
     * <p>Set the user's display name</p>
     * @param name The new display name
     */
    public async setDisplayName(name: string) {
        await this._ensureRegistered();
        return this.client.setDisplayName(name);
    }

    /**
     * <p>Set the user's avatar URL</p>
     * @param url The new avatar URL
     */
    public async setAvatarUrl(url: string) {
        await this._ensureRegistered();
        return this.client.setAvatarUrl(url);
    }

    /**
     * Create a new alias mapping.
     * @param alias The room alias to create
     * @param roomId The room ID the alias should point at.
     */
    public async createAlias(alias: string, roomId: string) {
        await this._ensureRegistered();
        return this.client.createAlias(alias, roomId);
    }

    /**
     * Set the presence of this user.
     * @param presence One of "online", "offline" or "unavailable".
     * @param status_msg The status message to attach.
     * @return Resolves if the presence was set or no-oped, rejects otherwise.
     */
    // eslint-disable-next-line camelcase
    public async setPresence(presence: string, status_msg?: string) {
        if (!this.opts.enablePresence) {
            return undefined;
        }

        await this._ensureRegistered();
        return this.client.setPresence({presence, status_msg});
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
        networkName: string,
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
        await this._ensureRegistered();
        if (useCache) {
            return this._requestCaches.event.get(`${roomId}:${eventId}`, roomId, eventId);
        }
        return this.client.fetchRoomEvent(roomId, eventId);
    }

    /**
     * Get a state event in a room.
     * This will automatically make the client join the room so they can get the
     * state if they are not already joined.
     * @param roomId The room to get the state from.
     * @param eventType The event type to fetch.
     * @param [stateKey=""] The state key of the event to fetch.
     */
    public async getStateEvent(roomId: string, eventType: string, stateKey = "") {
        await this._ensureJoined(roomId);
        return this.client.getStateEvent(roomId, eventType, stateKey);
    }

    /**
     * Inform this Intent class of an incoming event. Various optimisations will be
     * done if this is provided. For example, a /join request won't be sent out if
     * it knows you've already been joined to the room. This function does nothing
     * if a backing store was provided to the Intent.
     * @param event The incoming event JSON
     */
    // eslint-disable-next-line camelcase
    public onEvent(event: {type: string, content: {membership: MembershipState}, state_key: unknown, room_id: string}) {
        if (!this._membershipStates || !this._powerLevels) {
            return;
        }
        if (event.type === "m.room.member" &&
                event.state_key === this.client.credentials.userId) {
            this._membershipStates[event.room_id] = event.content.membership;
        }
        else if (event.type === "m.room.power_levels") {
            this._powerLevels[event.room_id] = event.content as unknown as PowerLevelContent;
        }
    }

    // Guard a function which returns a promise which may reject if the user is not
    // in the room. If the promise rejects, join the room and retry the function.
    private async _joinGuard(roomId: string, promiseFn: () => Promise<unknown>) {
        try {
            // await so we can handle the error
            return await promiseFn();
        }
        catch (err) {
            if (err.errcode !== "M_FORBIDDEN") {
                // not a guardable error
                throw err;
            }
            await this._ensureJoined(roomId, true);
            return promiseFn();
        }
    }

    private async _ensureJoined(
        roomId: string, ignoreCache = false, viaServers?: string[], passthroughError = false
    ) {
        const { userId } = this.client.credentials;
        const opts: { syncRoom: boolean, viaServers?: string[] } = {
            syncRoom: false,
        };
        if (viaServers) {
            opts.viaServers = viaServers;
        }
        if (this.opts.backingStore.getMembership(roomId, userId) === "join" && !ignoreCache) {
            return Promise.resolve();
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

        const deferredPromise = defer();

        const mark = (room: string, state: MembershipState) => {
            this.opts.backingStore.setMembership(room, userId, state);
            if (state === "join") {
                deferredPromise.resolve();
            }
        }

        const dontJoin = this.opts.dontJoin;

        try {
            await this._ensureRegistered();
            if (dontJoin) {
                deferredPromise.resolve();
                return deferredPromise.promise;
            }
            try {
                await this.client.joinRoom(roomId, opts);
                mark(roomId, "join");
            }
            catch (ex) {
                if (ex.errcode !== "M_FORBIDDEN") {
                    throw ex;
                }
                try {
                    // Try bot inviting client
                    await this.botClient.invite(roomId, userId);
                    await this.client.joinRoom(roomId, opts);
                    mark(roomId, "join");
                }
                catch (_ex) {
                    // Try bot joining
                    await this.botClient.joinRoom(roomId, opts)
                    await this.botClient.invite(roomId, userId);
                    await this.client.joinRoom(roomId, opts);
                    mark(roomId, "join");
                }
            }
        }
        catch (ex) {
            deferredPromise.reject(passthroughError ? ex : Error("Failed to join room"));
        }

        return deferredPromise.promise;
    }

    private async _ensureHasPowerLevelFor(roomId: string, eventType: string) {
        if (this.opts.dontCheckPowerLevel && eventType !== "m.room.power_levels") {
            return Promise.resolve();
        }
        const userId = this.client.credentials.userId;
        const plContent = this.opts.backingStore.getPowerLevelContent(roomId);
        let promise = Promise.resolve(plContent);
        if (!plContent) {
            promise = this.client.getStateEvent(roomId, "m.room.power_levels", "") as Promise<PowerLevelContent>;
        }
        return promise.then((eventContent) => {
            this.opts.backingStore.setPowerLevelContent(roomId, eventContent);
            const event = {
                content: eventContent,
                room_id: roomId,
                sender: "",
                event_id: "_",
                state_key: "",
                type: "m.room.power_levels"
            }
            const powerLevelEvent = new MatrixEvent(event);
            // What level do we need for this event type?
            const defaultLevel = STATE_EVENT_TYPES.includes(eventType)
                ? event.content.state_default
                : event.content.events_default;
            const requiredLevel = event.content.events[eventType] || defaultLevel;

            // Parse out what level the client has by abusing the JS SDK
            const roomMember = new RoomMember(roomId, userId);
            roomMember.setPowerLevelEvent(powerLevelEvent);

            if (requiredLevel > roomMember.powerLevel) {
                // can the bot update our power level?
                const bot = new RoomMember(roomId, this.botClient.credentials.userId);
                bot.setPowerLevelEvent(powerLevelEvent);
                const levelRequiredToModifyPowerLevels = event.content.events[
                    "m.room.power_levels"
                ] || event.content.state_default;
                if (levelRequiredToModifyPowerLevels > bot.powerLevel) {
                    // even the bot has no power here.. give up.
                    throw new Error(
                        "Cannot ensure client has power level for event " + eventType +
                        " : client has " + roomMember.powerLevel + " and we require " +
                        requiredLevel + " and the bot doesn't have permission to " +
                        "edit the client's power level."
                    );
                }
                // update the client's power level first
                return this.botClient.setPowerLevel(
                    roomId, userId, requiredLevel, powerLevelEvent
                ).then(() => {
                    // tweak the level for the client to reflect the new reality
                    const userLevels = powerLevelEvent.getContent().users || {};
                    userLevels[userId] = requiredLevel;
                    powerLevelEvent.getContent().users = userLevels;
                    return Promise.resolve(powerLevelEvent);
                });
            }
            return Promise.resolve(powerLevelEvent);
        });
    }

    private async _ensureRegistered() {
        if (this.opts.registered) {
            return "registered=true";
        }
        const userId = this.client.credentials.userId;
        const localpart = new MatrixUser(userId).localpart;
        try {
            const res = await this.botClient.register(localpart);
            this.opts.registered = true;
            return res;
        }
        catch (err) {
            if (err.errcode === "M_USER_IN_USE") {
                this.opts.registered = true;
                return null;
            }
            throw err;
        }
    }
}
