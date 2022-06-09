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
import Datastore from "nedb";
import {promises as fs} from "fs";
import * as util from "util";
import yaml from "js-yaml";
import { Application, Request as ExRequest, Response as ExResponse, NextFunction } from "express";

import { AppServiceRegistration, AppService, AppServiceOutput } from "matrix-appservice";
import { BridgeContext } from "./components/bridge-context";
import { AppServiceBot } from "./components/app-service-bot";
import { Intent, IntentOpts, IntentBackingStore, PowerLevelContent } from "./components/intent";
import { RoomBridgeStore } from "./components/room-bridge-store";
import { UserBridgeStore } from "./components/user-bridge-store";
import { UserActivityStore } from "./components/user-activity-store";
import { EventBridgeStore } from "./components/event-bridge-store";
import { MatrixUser } from "./models/users/matrix";
import { MatrixRoom } from "./models/rooms/matrix";
import { PrometheusMetrics, BridgeGaugesCounts } from "./components/prometheusmetrics";
import { MembershipCache, UserMembership, UserProfile } from "./components/membership-cache";
import { RoomLinkValidator, RoomLinkValidatorStatus, Rules } from "./components/room-link-validator"
import { RoomUpgradeHandler, RoomUpgradeHandlerOpts } from "./components/room-upgrade-handler";
import { EventQueue } from "./components/event-queue";
import { UserActivityTracker } from "./components/user-activity";
import { Defer, defer as deferPromise } from "./utils/promiseutil";
import { unstable } from "./errors";
import { BridgeStore } from "./components/bridge-store";
import { RemoteUser } from "./models/users/remote";
import BridgeInternalError = unstable.BridgeInternalError;
import wrapError = unstable.wrapError;
import EventNotHandledError = unstable.EventNotHandledError;
import { ThirdpartyProtocolResponse, ThirdpartyLocationResponse, ThirdpartyUserResponse } from "./thirdparty";
import { RemoteRoom } from "./models/rooms/remote";
import { Registry } from "prom-client";
import { ClientEncryptionStore, EncryptedEventBroker } from "./components/encryption";
import { EphemeralEvent, WeakEvent } from "./components/event-types";
import * as BotSDK from "matrix-bot-sdk";
import { ActivityTracker, ActivityTrackerOpts } from "./components/activity-tracker";
import { EncryptedIntent, EncryptedIntentOpts } from "./components/encrypted-intent";
import { Logger, RequestFactory, Request } from ".";
import { EphemeralMatrixRequest, TimelineMatrixRequest } from "./components/requests/matrix-request";

const log = new Logger("bridge.Bridge");

// The frequency at which we will check the list of accumulated Intent objects.
const INTENT_CULL_CHECK_PERIOD_MS = 1000 * 60; // once per minute
// How long a given Intent object can hang around unused for.
const INTENT_CULL_EVICT_AFTER_MS = 1000 * 60 * 15; // 15 minutes

export const BRIDGE_PING_EVENT_TYPE = "org.matrix.bridge.ping";
export const BRIDGE_PING_TIMEOUT_MS = 60000;

// How old can a receipt be before we treat it as stale.
const RECEIPT_CUTOFF_TIME_MS = 60000;

export interface BridgeController {
    /**
     * The bridge will invoke when an event has been received from the HS.
     */
    onEvent: (request: TimelineMatrixRequest, context?: BridgeContext) => void;
    /**
     * The bridge will invoke this when a typing, read reciept or presence event
     * is received from the HS. **This will only work with the `bridgeEncryption`
     * configuration set.**
     */
    onEphemeralEvent?: (request: EphemeralMatrixRequest) => void;
    /**
     * The bridge will invoke this function when queried via onUserQuery. If
     * not supplied, no users will be provisioned on user queries. Provisioned users
     * will automatically be stored in the associated `userStore`.
     */
    onUserQuery?: (matrixUser: MatrixUser) =>
        PossiblePromise<{name?: string, url?: string, remote?: RemoteUser}|null|void>;
    /**
     * The bridge will invoke this function when queried via onAliasQuery. If
     * not supplied, no rooms will be provisioned on alias queries. Provisioned rooms
     * will automatically be stored in the associated `roomStore`. */
    onAliasQuery?: (alias: string, aliasLocalpart: string) =>
        PossiblePromise<{roomId?: string, creationOpts?: Record<string, unknown>, remote?: RemoteRoom}|null|void>;
    /**
     * The bridge will invoke this function when a room has been created
     * via onAliasQuery.
     */
    onAliasQueried?: (alias: string, roomId: string) => PossiblePromise<void>;
    /**
     * If supplied, the bridge will respond to third-party entity lookups using the
     * contained helper functions.
     */
    thirdPartyLookup?: {
        protocols: string[];
        getProtocol?(protocol: string): PossiblePromise<ThirdpartyProtocolResponse>;
        getLocation?(protocol: string, fields: Record<string, string[]|string>):
            PossiblePromise<ThirdpartyLocationResponse[]>;
        parseLocation?(alias: string): PossiblePromise<ThirdpartyLocationResponse[]>;
        getUser?(protocol: string, fields: Record<string, string[]|string>):
            PossiblePromise<ThirdpartyUserResponse[]>;
        parseUser?(userid: string): PossiblePromise<ThirdpartyLocationResponse[]>;
    };

    userActivityTracker?: UserActivityTracker;
}

type PossiblePromise<T> = T|Promise<T>;

export interface BridgeOpts {
    /**
     * Application service registration object or path to the registration file.
     */
    registration: AppServiceRegistration|string;
    /**
     * The base HS url
     */
    homeserverUrl: string;
    /**
     * The domain part for user_ids and room aliases e.g. "bar" in "@foo:bar".
     */
    domain: string;
    /**
     * A human readable string that will be used when the bridge signals errors
     * to the client. Will not include in error events if ommited.
     */
    networkName?: string;
    /**
     * The controller logic for the bridge.
     */
    controller: BridgeController;
    /**
     * True to disable enabling of stores.
     * This should be used by bridges that use their own database instances and
     * do not need any of the included store objects. This implies setting
     * disableContext to True. Default: false.
     */
    disableStores?: boolean;
    /**
     * The room store instance to use, or the path to the room .db file to load.
     * A database will be created if this is not specified. If `disableStores` is set,
     * no database will be created or used.
     */
    roomStore?: RoomBridgeStore|string;
    /**
     * The user store instance to use, or the path to the user .db file to load.
     * A database will be created if this is not specified. If `disableStores` is set,
     * no database will be created or used.
     */
    userStore?: UserBridgeStore|string;
    /**
     * The user activity store instance to use, or the path to the user .db file to load.
     * A database will be created if this is not specified. If `disableStores` is set,
     * no database will be created or used.
     */
    userActivityStore?: UserActivityStore|string;
    /**
     * The event store instance to use, or the path to the user .db file to load.
     * A database will NOT be created if this is not specified. If `disableStores` is set,
     * no database will be created or used.
     */
    eventStore?: EventBridgeStore|string;
    /**
     * The membership cache instance
     * to use, which can be manually created by a bridge for greater control over
     * caching. By default a membership cache will be created internally.
     */
    membershipCache?: MembershipCache;
    /**
     * True to stop receiving onEvent callbacks
     * for events which were sent by a bridge user. Default: true.
     */
    suppressEcho?: boolean;
    /**
     * True to enable SUCCESS/FAILED log lines to be sent to onLog. Default: true.
     */
    logRequestOutcome?: boolean;
    /**
     * Escape userIds for non-bot intents with
     * {@link MatrixUser~escapeUserId}
     * Default: true
     */
    escapeUserIds?: boolean;
    /**
     * Options to supply to created Intent instances.
     */
    intentOptions?: {
        /**
         * Options to supply to the bot intent.
         */
        bot?: IntentOpts;
        /**
         * Options to supply to the client intents.
         */
        clients?: IntentOpts;
    };
    /**
     * The factory function used to create intents.
     */
    onIntentCreate?: (userId: string) => Intent,
    /**
     * Options for the `onEvent` queue. When the bridge
     * receives an incoming transaction, it needs to asyncly query the data store for
     * contextual info before calling onEvent. A queue is used to keep the onEvent
     * calls consistent with the arrival order from the incoming transactions.
     */
    queue?: {
        /**
         * The type of queue to use when feeding through to {@link Bridge~onEvent}.
         * - If `none`, events are fed through as soon as contextual info is obtained, which may result
         * in out of order events but stops HOL blocking.
         * - If `single`, onEvent calls will be in order but may be slower due to HOL blocking.
         * - If `per_room`, a queue per room ID is made which reduces the impact of HOL blocking to be scoped to a room.
         *
         * Default: `single`.
         */
        type?: "none"|"single"|"per_room";
        /**
         * `true` to only feed through the next event after the request object in the previous
         * call succeeds or fails. It is **vital** that you consistently resolve/reject the
         * request if this is 'true', else you will not get any further events from this queue.
         * To aid debugging this, consider setting a delayed listener on the request factory.
         *
         * If `false`, the mere invocation of onEvent is enough to trigger the next event in the queue.
         * You probably want to set this to `true` if your {@link Bridge~onEvent} is
         * performing async operations where ordering matters (e.g. messages).
         *
         * Default: false.
         * */
        perRequest?: boolean;
    };
    /**
     * `true` to disable {@link BridgeContext}
     * parameters in {@link Bridge.onEvent}. Disabling the context makes the
     * bridge do fewer database lookups, but prevents there from being a
     * `context` parameter.
     *
     * Default: `false`.
     */
    disableContext?: boolean;
    roomLinkValidation?: {
        rules: Rules;
    };
    authenticateThirdpartyEndpoints?: boolean;
    roomUpgradeOpts?: RoomUpgradeHandlerOpts;

    bridgeEncryption?: {
        homeserverUrl: string;
        store: ClientEncryptionStore;
    };

    eventValidation?: {
        /**
         * Should we validate that the sender of an edit matches the parent event.
         */
        validateEditSender?: {
            /**
             * If the parent edit event could not be found,
             * should the event be rejected.
             */
            allowEventOnLookupFail: boolean;
        };
    };

    trackUserActivity?: ActivityTrackerOpts;
}

interface VettedBridgeOpts {
    /**
     * Application service registration object or path to the registration file.
     */
    registration: AppServiceRegistration | string;
    /**
     * The base HS url
     */
    homeserverUrl: string;
    /**
     * The domain part for user_ids and room aliases e.g. "bar" in "@foo:bar".
     */
    domain: string;
    /**
     * A human readable string that will be used when the bridge signals errors
     * to the client. Will not include in error events if ommited.
     */
    networkName?: string;
    /**
     * The controller logic for the bridge.
     */
    controller: BridgeController;
    /**
     * True to disable enabling of stores.
     * This should be used by bridges that use their own database instances and
     * do not need any of the included store objects. This implies setting
     * disableContext to True. Default: false.
     */
    disableStores: boolean;
    /**
     * The room store instance to use, or the path to the room .db file to load.
     * A database will be created if this is not specified. If `disableStores` is set,
     * no database will be created or used.
     */
    roomStore: RoomBridgeStore | string;
    /**
     * The user store instance to use, or the path to the user .db file to load.
     * A database will be created if this is not specified. If `disableStores` is set,
     * no database will be created or used.
     */
    userStore: UserBridgeStore | string;
    /**
     * The user activity store instance to use, or the path to the user .db file to load.
     * A database will be created if this is not specified. If `disableStores` is set,
     * no database will be created or used.
     */
    userActivityStore: UserActivityStore | string;
    /**
     * The event store instance to use, or the path to the user .db file to load.
     * A database will NOT be created if this is not specified. If `disableStores` is set,
     * no database will be created or used.
     */
    eventStore?: EventBridgeStore | string;
    /**
     * True to stop receiving onEvent callbacks
     * for events which were sent by a bridge user. Default: true.
     */
    suppressEcho: boolean;
    /**
     * True to enable SUCCESS/FAILED log lines to be sent to onLog. Default: true.
     */
    logRequestOutcome?: boolean;
    /**
     * Escape userIds for non-bot intents with
     * {@link MatrixUser~escapeUserId}
     * Default: true
     */
    escapeUserIds?: boolean;
    /**
     * Options to supply to created Intent instances.
     */
    intentOptions: {
        /**
         * Options to supply to the bot intent.
         */
        bot?: IntentOpts;
        /**
         * Options to supply to the client intents.
         */
        clients?: IntentOpts;
    };
    /**
     * The factory function used to create intents. If encryptionOpts is specified, this should create an
     * EncryptedIntent instead.
     */
    onIntentCreate: (userId: string, opts: IntentOpts, encryptionOpts?: EncryptedIntentOpts) => Intent|EncryptedIntent,
    /**
     * Options for the `onEvent` queue. When the bridge
     * receives an incoming transaction, it needs to asyncly query the data store for
     * contextual info before calling onEvent. A queue is used to keep the onEvent
     * calls consistent with the arrival order from the incoming transactions.
     */
    queue: {
        /**
         * The type of queue to use when feeding through to {@link Bridge~onEvent}.
         * - If `none`, events are fed through as soon as contextual info is obtained, which may result
         * in out of order events but stops HOL blocking.
         * - If `single`, onEvent calls will be in order but may be slower due to HOL blocking.
         * - If `per_room`, a queue per room ID is made which reduces the impact of HOL blocking to be scoped to a room.
         *
         * Default: `single`.
         */
        type: "none" | "single" | "per_room";
        /**
         * `true` to only feed through the next event after the request object in the previous
         * call succeeds or fails. It is **vital** that you consistently resolve/reject the
         * request if this is 'true', else you will not get any further events from this queue.
         * To aid debugging this, consider setting a delayed listener on the request factory.
         *
         * If `false`, the mere invocation of onEvent is enough to trigger the next event in the queue.
         * You probably want to set this to `true` if your {@link Bridge~onEvent} is
         * performing async operations where ordering matters (e.g. messages).
         *
         * Default: false.
         * */
        perRequest: boolean;
    };
    /**
     * `true` to disable {@link BridgeContext}
     * parameters in {@link Bridge.onEvent}. Disabling the context makes the
     * bridge do fewer database lookups, but prevents there from being a
     * `context` parameter.
     *
     * Default: `false`.
     */
    disableContext: boolean;
    roomLinkValidation?: {
        rules: Rules;
    };
    authenticateThirdpartyEndpoints: boolean;
    roomUpgradeOpts?: RoomUpgradeHandlerOpts;
    bridgeEncryption?: {
        homeserverUrl: string;
        store: ClientEncryptionStore;
    };
    eventValidation?: {
        validateEditSender?: {
            allowEventOnLookupFail: boolean;
        };
    };
    userActivityTracking?: ActivityTrackerOpts;
}

export class Bridge {
    private requestFactory: RequestFactory;
    private intents: Map<string, {
        intent: Intent|EncryptedIntent, lastAccessed: number
    }>; // user_id + request_id => Intent
    private powerlevelMap: Map<string, PowerLevelContent>; // room_id => powerlevels
    private membershipCache: MembershipCache;
    private queue: EventQueue;
    private intentBackingStore: IntentBackingStore;
    private prevRequestPromise: Promise<unknown>;
    private intentLastAccessedTimeout: NodeJS.Timeout|null = null;
    private botIntent?: Intent;
    private appServiceBot?: AppServiceBot;
    private metrics?: PrometheusMetrics;
    private roomLinkValidator?: RoomLinkValidator;
    private roomUpgradeHandler?: RoomUpgradeHandler;
    private roomStore?: RoomBridgeStore;
    private userStore?: UserBridgeStore;
    private userActivityStore?: UserActivityStore;
    private eventStore?: EventBridgeStore;
    private registration?: AppServiceRegistration;
    private appservice?: AppService;
    private botSdkAS?: BotSDK.Appservice;
    private eeEventBroker?: EncryptedEventBroker;
    private selfPingDeferred?: {
        defer: Defer<void>;
        roomId: string;
        timeout: NodeJS.Timeout;
    }

    public readonly opts: VettedBridgeOpts;

    private internalActivityTracker?: ActivityTracker;

    public get activityTracker(): ActivityTracker|undefined {
        return this.internalActivityTracker;
    }

    public get appService(): AppService {
        if (!this.appservice) {
            throw Error('appservice not defined yet');
        }
        return this.appservice;
    }

    public get botUserId(): string {
        if (!this.registration) {
            throw Error('Registration not defined yet');
        }
        return `@${this.registration.getSenderLocalpart()}:${this.opts.domain}`;
    }

    /**
     * @param opts Options to pass to the bridge
     * @param opts.roomUpgradeOpts Options to supply to
     * the room upgrade handler. If not defined then upgrades are NOT handled by the bridge.
     */
    constructor (opts: BridgeOpts) {
        if (typeof opts !== "object") {
            throw new Error("opts must be supplied.");
        }
        const required = [
            "homeserverUrl", "registration", "domain", "controller"
        ];
        const missingKeys = required.filter(k => !Object.keys(opts).includes(k));
        if (missingKeys.length) {
            throw new Error(`Missing '${missingKeys.join("', '")}' in opts.`);
        }

        if (typeof opts.controller.onEvent !== "function") {
            throw new Error("controller.onEvent is a required function");
        }

        this.opts = {
            ...opts,
            disableContext: opts.disableStores ? true : (opts.disableContext ?? false),
            disableStores: opts.disableStores ?? false,
            authenticateThirdpartyEndpoints: opts.authenticateThirdpartyEndpoints ?? false,
            userStore: opts.userStore || "user-store.db",
            userActivityStore: opts.userActivityStore || "user-activity-store.db",
            roomStore: opts.roomStore || "room-store.db",
            intentOptions: opts.intentOptions || {},
            onIntentCreate: opts.onIntentCreate ?? this.onIntentCreate.bind(this),
            queue: {
                type: opts.queue?.type || "single",
                perRequest: opts.queue?.perRequest ?? false,
            },
            suppressEcho: opts.suppressEcho ?? true,
            eventValidation: opts.hasOwnProperty("eventValidation") ? opts.eventValidation : {
                validateEditSender: {
                    allowEventOnLookupFail: false
                }
            }
        };

        this.queue = EventQueue.create(this.opts.queue, this.onConsume.bind(this));

        // we'll init these at runtime
        this.requestFactory = new RequestFactory();
        this.intents = new Map();
        this.powerlevelMap = new Map();
        this.membershipCache = opts.membershipCache || new MembershipCache();
        this.intentBackingStore = {
            setMembership: this.membershipCache.setMemberEntry.bind(this.membershipCache),
            setPowerLevelContent: this.setPowerLevelEntry.bind(this),
            getMembership: this.membershipCache.getMemberEntry.bind(this.membershipCache),
            getMemberProfile: this.membershipCache.getMemberProfile.bind(this.membershipCache),
            getPowerLevelContent: this.getPowerLevelEntry.bind(this)
        };

        this.prevRequestPromise = Promise.resolve();

        if (this.opts.roomUpgradeOpts) {
            this.opts.roomUpgradeOpts.consumeEvent = this.opts.roomUpgradeOpts.consumeEvent !== false;
            if (this.opts.disableStores) {
                this.opts.roomUpgradeOpts.migrateStoreEntries = false;
            }
            this.roomUpgradeHandler = new RoomUpgradeHandler(this.opts.roomUpgradeOpts, this);
        }
    }

    /**
     * Load the user and room databases. Access them via getUserStore() and getRoomStore().
     */
    public async loadDatabases(): Promise<void> {
        if (this.opts.disableStores) {
            return;
        }

        const storePromises: Promise<BridgeStore>[] = [];
        // Load up the databases if they provided file paths to them (or defaults)
        if (typeof this.opts.userStore === "string") {
            storePromises.push(loadDatabase(this.opts.userStore, UserBridgeStore));
        }
        else {
            storePromises.push(Promise.resolve(this.opts.userStore));
        }
        if (typeof this.opts.userActivityStore === "string") {
            storePromises.push(loadDatabase(this.opts.userActivityStore, UserActivityStore));
        }
        else {
            storePromises.push(Promise.resolve(this.opts.userActivityStore));
        }
        if (typeof this.opts.roomStore === "string") {
            storePromises.push(loadDatabase(this.opts.roomStore, RoomBridgeStore));
        }
        else {
            storePromises.push(Promise.resolve(this.opts.roomStore));
        }
        if (typeof this.opts.eventStore === "string") {
            storePromises.push(loadDatabase(this.opts.eventStore, EventBridgeStore));
        }
        else if (this.opts.eventStore) {
            storePromises.push(Promise.resolve(this.opts.eventStore));
        }

        // This works because if they provided a string we converted it to a Promise
        // which will be resolved when we have the db instance. If they provided a
        // db instance then this will resolve immediately.
        const [userStore, userActivityStore, roomStore, eventStore] = await Promise.all(storePromises);
        this.userStore = userStore as UserBridgeStore;
        this.userActivityStore = userActivityStore as UserActivityStore;
        this.roomStore = roomStore as RoomBridgeStore;
        this.eventStore = eventStore as EventBridgeStore;
    }

    /**
     * Load registration, databases and initalise bridge components.
     *
     * **This must be called before `listen()`**
     */
    public async initalise(): Promise<void> {
        if (typeof this.opts.registration === "string") {
            const regObj = yaml.load(await fs.readFile(this.opts.registration, 'utf8'));
            if (typeof regObj !== "object") {
                throw Error("Failed to parse registration file: yaml file did not parse to object")
            }
            const registration = AppServiceRegistration.fromObject(regObj as AppServiceOutput);
            if (registration === null) {
                throw Error("Failed to parse registration file");
            }
            this.registration = registration;
        }
        else {
            this.registration = this.opts.registration;
        }

        const asToken = this.registration.getAppServiceToken();
        if (!asToken) {
            throw Error('No AS token provided in registration config!');
        }
        const rawReg = this.registration.getOutput();
        this.botSdkAS = new BotSDK.Appservice({
            registration: {
                ...rawReg,
                url: rawReg.url || undefined,
                protocols: rawReg.protocols || undefined,
                namespaces: {
                    users: [{
                        // Deliberately greedy regex to fix https://github.com/turt2live/matrix-bot-sdk/issues/159
                        // Note: We don't use the localpart generating functionality of the bot-sdk,
                        // so this is okay to do.
                        regex: "@.+_.+:.*",
                        exclusive: true,
                    }],
                    rooms: rawReg.namespaces?.rooms || [],
                    aliases: rawReg.namespaces?.aliases || [],
                }
            },
            // If using encryption, we want to go via pantalaimon.
            homeserverUrl: this.opts.bridgeEncryption?.homeserverUrl || this.opts.homeserverUrl,
            homeserverName: this.opts.domain,
            // Unused atm.
            port: 0,
            bindAddress: "127.0.0.1",
        });

        if (this.metrics) {
            this.metrics.registerMatrixSdkMetrics(this.botSdkAS);
        }

        await this.checkHomeserverSupport();
        this.appServiceBot = new AppServiceBot(
            this.botSdkAS.botClient, this.botUserId, this.registration, this.membershipCache,
        );

        if (this.opts.bridgeEncryption) {
            this.eeEventBroker = new EncryptedEventBroker(
                this.membershipCache,
                this.appServiceBot,
                this.onEvent.bind(this),
                this.getIntent.bind(this),
                this.opts.bridgeEncryption.store,
            );
        }

        if (this.opts.roomLinkValidation !== undefined) {
            this.roomLinkValidator = new RoomLinkValidator(
                this.opts.roomLinkValidation,
                this.appServiceBot,
            );
        }

        if (this.opts.logRequestOutcome) {
            this.requestFactory.addDefaultResolveCallback(req =>
                req.info(
                    `SUCCESS (${req.getDuration()}ms)`,
                    false,
                )
            );
            this.requestFactory.addDefaultRejectCallback((req, err) =>
                req.info(
                    `FAILED (${req.getDuration()}ms)`,
                    (err ? util.inspect(err) : ""),
                    false,
                )
            );
        }

        const botIntentOpts: IntentOpts = {
            registered: true,
            backingStore: this.intentBackingStore,
            ...this.opts.intentOptions?.bot, // copy across opts, if defined
        };
        this.botIntent = this.opts.onIntentCreate(this.botUserId, botIntentOpts);

        this.setupIntentCulling();

        if (this.opts.userActivityTracking) {
            if (!this.registration.pushEphemeral) {
                log.info("Sending ephemeral events to the bridge is currently disabled in the registration file," +
                " so user activity will not be captured");
            }
            this.internalActivityTracker = new ActivityTracker(
                this.botIntent.matrixClient, this.opts.userActivityTracking
            );
        }

        await this.loadDatabases();
    }

    /**
     * Setup a HTTP listener to handle appservice traffic.
     * ** This must be called after .initalise() **
     * @param port The port to listen on.
     * @param appServiceInstance The AppService instance to attach to.
     * If not provided, one will be created.
     * @param hostname Optional hostname to bind to.
     */
    public async listen(
        port: number, hostname = "0.0.0.0", backlog = 10, appServiceInstance?: AppService): Promise<void> {
        if (!this.registration) {
            throw Error('initalise() not called, cannot listen');
        }

        const homeserverToken = this.registration.getHomeserverToken();
        if (!homeserverToken) {
            throw Error('No HS token provided, cannot create AppService');
        }

        this.appservice = appServiceInstance || new AppService({
            homeserverToken,
        });
        this.appservice.onUserQuery = (userId) => this.onUserQuery(userId);
        this.appservice.onAliasQuery = this.onAliasQuery.bind(this);
        this.appservice.on("event", async (event) => {
            let passthrough = true;
            const weakEvent = event as WeakEvent;
            if (this.eeEventBroker) {
                passthrough = await this.eeEventBroker.onASEvent(weakEvent);
            }
            if (passthrough) {
                return this.onEvent(weakEvent);
            }
            return undefined;
        });
        this.appservice.on("ephemeral", async (event) =>
            this.onEphemeralEvent(event as unknown as EphemeralEvent)
        );
        const httpLog = new Logger("bridge.HttpLog");
        this.appservice.on("http-log", line => httpLog.debug(line));

        this.customiseAppserviceThirdPartyLookup();
        if (this.metrics) {
            this.metrics.addAppServicePath(this);
        }
        await this.appservice.listen(port, hostname, backlog);
    }

    /**
     * Run the bridge (start listening). This calls `initalise()` and `listen()`.
     * @param port The port to listen on.
     * @param appServiceInstance The AppService instance to attach to.
     * If not provided, one will be created.
     * @param hostname Optional hostname to bind to.
     * @return A promise resolving when the bridge is ready.
     */
    public async run(port: number, appServiceInstance?: AppService, hostname = "0.0.0.0", backlog = 10): Promise<void> {
        await this.initalise();
        await this.listen(port, hostname, backlog, appServiceInstance);
    }

    // Set a timer going which will periodically remove Intent objects to prevent
    // them from accumulating too much. Removal is based on access time (calls to
    // getIntent). Intents expire after `INTENT_CULL_EVICT_AFTER_MS` of not being called.
    private setupIntentCulling() {
        if (this.intentLastAccessedTimeout) {
            clearTimeout(this.intentLastAccessedTimeout);
        }
        this.intentLastAccessedTimeout = setTimeout(() => {
            const now = Date.now();
            for (const [key, entry] of this.intents.entries()) {
                // Do not delete intents that sync.
                const lastAccess = now - entry.lastAccessed;
                if (lastAccess < INTENT_CULL_EVICT_AFTER_MS) {
                    // Intent is still in use.
                    continue;
                }
                if (this.eeEventBroker?.shouldAvoidCull(entry.intent)) {
                    // Intent is syncing events for encrypted rooms
                    continue;
                }
                this.intents.delete(key);
            }
            this.intentLastAccessedTimeout = null;
            // repeat forever. We have no cancellation mechanism but we don't expect
            // Bridge objects to be continually recycled so this is fine.
            this.setupIntentCulling();
        }, INTENT_CULL_CHECK_PERIOD_MS);
    }

    private customiseAppserviceThirdPartyLookup() {
        const lookupController = this.opts.controller.thirdPartyLookup;
        if (!lookupController) {
            // Nothing to do.
            return;
        }
        const protocols = lookupController.protocols || [];

        const respondErr = function(e: {code?: number, err?: string}, res: ExResponse) {
            if (e.code && e.err) {
                res.status(e.code).json({error: e.err});
            }
            else {
                res.status(500).send("Failed: " + e);
            }
        }

        if (lookupController.getProtocol) {
            const getProtocolFunc = lookupController.getProtocol;

            this.addAppServicePath({
                method: "GET",
                path: "/_matrix/app/:version(v1|unstable)/thirdparty/protocol/:protocol",
                checkToken: this.opts.authenticateThirdpartyEndpoints,
                handler: async (req, res) => {
                    const protocol = req.params.protocol;

                    if (protocols.length && protocols.indexOf(protocol) === -1) {
                        res.status(404).json({err: "Unknown 3PN protocol " + protocol});
                        return;
                    }

                    try {
                        const result = await getProtocolFunc(protocol);
                        res.status(200).json(result);
                    }
                    catch (ex) {
                        respondErr(ex, res)
                    }
                },
            });
        }

        if (lookupController.getLocation) {
            const getLocationFunc = lookupController.getLocation;

            this.addAppServicePath({
                method: "GET",
                path: "/_matrix/app/:version(v1|unstable)/thirdparty/location/:protocol",
                checkToken: this.opts.authenticateThirdpartyEndpoints,
                handler: async (req, res) => {
                    const protocol = req.params.protocol;

                    if (protocols.length && protocols.indexOf(protocol) === -1) {
                        res.status(404).json({err: "Unknown 3PN protocol " + protocol});
                        return;
                    }

                    // Do not leak access token to function
                    delete req.query.access_token;

                    try {
                        const result = await getLocationFunc(protocol, req.query as Record<string, string[]|string>);
                        res.status(200).json(result);
                    }
                    catch (ex) {
                        respondErr(ex, res)
                    }
                },
            });
        }

        if (lookupController.parseLocation) {
            const parseLocationFunc = lookupController.parseLocation;

            this.addAppServicePath({
                method: "GET",
                path: "/_matrix/app/:version(v1|unstable)/thirdparty/location",
                checkToken: this.opts.authenticateThirdpartyEndpoints,
                handler: async (req, res) => {
                    const alias = req.query.alias;
                    if (!alias) {
                        res.status(400).send({err: "Missing 'alias' parameter"});
                        return;
                    }
                    if (typeof alias !== "string") {
                        res.status(400).send({err: "'alias' must be a string"});
                        return;
                    }

                    try {
                        const result = await parseLocationFunc(alias);
                        res.status(200).json(result);
                    }
                    catch (ex) {
                        respondErr(ex, res)
                    }
                },
            });
        }

        if (lookupController.getUser) {
            const getUserFunc = lookupController.getUser;

            this.addAppServicePath({
                method: "GET",
                path: "/_matrix/app/:version(v1|unstable)/thirdparty/user/:protocol",
                checkToken: this.opts.authenticateThirdpartyEndpoints,
                handler: async (req, res) => {
                    const protocol = req.params.protocol;

                    if (protocols.length && protocols.indexOf(protocol) === -1) {
                        res.status(404).json({err: "Unknown 3PN protocol " + protocol});
                        return;
                    }

                    // Do not leak access token to function
                    delete req.query.access_token;

                    try {
                        const result = await getUserFunc(protocol, req.query as Record<string, string[]|string>);
                        res.status(200).json(result);
                    }
                    catch (ex) {
                        respondErr(ex, res)
                    }
                }
            });
        }

        if (lookupController.parseUser) {
            const parseUserFunc = lookupController.parseUser;

            this.addAppServicePath({
                method: "GET",
                path: "/_matrix/app/:version(v1|unstable)/thirdparty/user",
                checkToken: this.opts.authenticateThirdpartyEndpoints,
                handler: async (req, res) => {
                    const userid = req.query.userid;
                    if (!userid) {
                        res.status(400).send({err: "Missing 'userid' parameter"});
                        return;
                    }
                    if (typeof userid !== "string") {
                        res.status(400).send({err: "'userid' must be a string"});
                        return;
                    }

                    try {
                        const result = await parseUserFunc(userid);
                        res.status(200).json(result);
                    }
                    catch (ex) {
                        respondErr(ex, res)
                    }
                },
            });
        }
    }

    /**
     * Install a custom handler for an incoming HTTP API request. This allows
     * callers to add extra functionality, implement new APIs, etc...
     * @param opts Named options
     * @param opts.method The HTTP method name.
     * @param opts.path Path to the endpoint.
     * @param opts.checkToken Should the token be automatically checked. Defaults to true.
     * @param opts.handler Function to handle requests
     * to this endpoint.
     */
    public addAppServicePath(opts: {
        method: "GET"|"PUT"|"POST"|"DELETE",
        checkToken?: boolean,
        path: string,
        handler: (req: ExRequest, respose: ExResponse, next: NextFunction) => void,
    }): void {
        if (!this.appservice) {
            throw Error('Cannot call addAppServicePath before calling .run()');
        }
        const app: Application = this.appservice.expressApp;
        opts.checkToken = opts.checkToken !== undefined ? opts.checkToken : true;
        // TODO(paul): Consider more options:
        //   opts.versions - automatic version filtering and rejecting of
        //     unrecognised API versions
        // Consider automatic "/_matrix/app/:version(v1|unstable)" path prefix
        app[opts.method.toLowerCase() as "get"|"put"|"post"|"delete"](opts.path, (req, res, ...args) => {
            if (opts.checkToken && !this.requestCheckToken(req)) {
                return res.status(403).send({
                    errcode: "M_FORBIDDEN",
                    error: "Bad token supplied,"
                });
            }
            return opts.handler(req, res, ...args);
        });
    }

    /**
     * Retrieve the connected room store instance, if one was configured.
     */
    public getRoomStore(): RoomBridgeStore|undefined {
        return this.roomStore;
    }

    /**
     * Retrieve the connected user store instance, if one was configured.
     */
    public getUserStore(): UserBridgeStore|undefined {
        return this.userStore;
    }

    /**
     * Retrieve the connected user activity store instance.
     */
    public getUserActivityStore(): UserActivityStore|undefined {
        return this.userActivityStore;
    }

    /**
     * Retrieve the connected event store instance, if one was configured.
     */
    public getEventStore(): EventBridgeStore|undefined {
        return this.eventStore;
    }

    /**
     * Retrieve the request factory used to create incoming requests.
     */
    public getRequestFactory(): RequestFactory {
        return this.requestFactory;
    }

    /**
     * Get the AS bot instance.
     */
    public getBot(): AppServiceBot {
        if (!this.appServiceBot) {
            throw Error('Bridge is not ready');
        }
        return this.appServiceBot;
    }

    /**
     * Determines whether a room should be provisoned based on
     * user provided rules and the room state. Will default to true
     * if no rules have been provided.
     * @param roomId The room to check.
     * @param cache Should the validator check its cache.
     * @returns resolves if can and rejects if it cannot.
     *          A status code is returned on both.
     */
    public async canProvisionRoom(roomId: string, cache=true): Promise<RoomLinkValidatorStatus> {
        if (!this.roomLinkValidator) {
            return RoomLinkValidatorStatus.PASSED;
        }
        return this.roomLinkValidator.validateRoom(roomId, cache);
    }

    public getRoomLinkValidator(): RoomLinkValidator | undefined {
        return this.roomLinkValidator;
    }

    /**
     * Retrieve an Intent instance for the specified user ID. If no ID is given, an
     * instance for the bot itself is returned.
     * @param userId Optional. The user ID to get an Intent for.
     * @param request Optional. The request instance to tie the MatrixClient
     * instance to. Useful for logging contextual request IDs.
     * @return The intent instance
     */
    public getIntent(userId?: string, request?: Request<unknown>): Intent|EncryptedIntent {
        if (!this.appServiceBot || !this.botSdkAS) {
            throw Error('Cannot call getIntent before calling .initalise()');
        }
        if (!userId) {
            if (!this.botIntent) {
                // This will be defined when .run is called.
                throw Error('Cannot call getIntent before calling .initalise()');
            }
            return this.botIntent;
        }
        else if (userId === this.botUserId) {
            if (!this.botIntent) {
                // This will be defined when .run is called.
                throw Error('Cannot call getIntent before calling .initalise()');
            }
            return this.botIntent;
        }

        if (this.opts.escapeUserIds === undefined || this.opts.escapeUserIds) {
            userId = new MatrixUser(userId).getId(); // Escape the ID
        }

        const key = userId + (request ? request.getId() : "");
        const existingIntent = this.intents.get(key);
        if (existingIntent) {
            existingIntent.lastAccessed = Date.now();
            return existingIntent.intent;
        }

        const clientIntentOpts: IntentOpts = {
            backingStore: this.intentBackingStore,
            ...this.opts.intentOptions?.clients,
            onEventSent: () => userId && this.opts.controller.userActivityTracker?.updateUserActivity(userId),
        };
        clientIntentOpts.registered = this.membershipCache.isUserRegistered(userId);
        let encryptionIntentOpts: undefined|EncryptedIntentOpts;
        const encryptionOpts = this.opts.bridgeEncryption;
        if (encryptionOpts) {
            encryptionIntentOpts = {
                sessionPromise: encryptionOpts.store.getStoredSession(userId),
                originalHomeserverUrl: this.opts.homeserverUrl,
                sessionCreatedCallback: encryptionOpts.store.setStoredSession.bind(encryptionOpts.store),
                ensureClientSyncingCallback: async () => {
                    return this.eeEventBroker?.startSyncingUser(userId || this.botUserId);
                },
            };
        }

        const intent = this.opts.onIntentCreate(userId, clientIntentOpts, encryptionIntentOpts);
        this.intents.set(key, { intent, lastAccessed: Date.now() });

        return intent;
    }

    /**
     * Retrieve an Intent instance for the specified user ID localpart. This <i>must
     * be the complete user localpart</i>.
     * @param localpart The user ID localpart to get an Intent for.
     * @param request Optional. The request instance to tie the MatrixClient
     * instance to. Useful for logging contextual request IDs.
     * @return The intent instance
     */
    public getIntentFromLocalpart(localpart: string, request?: Request<unknown>): Intent {
        return this.getIntent(
            "@" + localpart + ":" + this.opts.domain, request,
        );
    }


    /**
     * Provision a user on the homeserver.
     * @param matrixUser The virtual user to be provisioned.
     * @param provisionedUser Provisioning information.
     * @return Resolved when provisioned.
     */
    public async provisionUser(
        matrixUser: MatrixUser,
        provisionedUser?: {name?: string, url?: string, remote?: RemoteUser}
    ): Promise<void> {
        if (!this.botSdkAS) {
            throw Error('Cannot call getIntent before calling .run()');
        }
        const intent = this.getIntentFromLocalpart(matrixUser.localpart);
        await intent.ensureRegistered();

        if (!this.opts.disableStores) {
            if (!this.userStore) {
                throw Error('Tried to call provisionUser before databases were loaded');
            }
            await this.userStore.setMatrixUser(matrixUser);
            if (provisionedUser?.remote) {
                await this.userStore.linkUsers(matrixUser, provisionedUser.remote);
            }
        }
        if (provisionedUser?.name) {
            await intent.setDisplayName(provisionedUser.name);
        }
        if (provisionedUser?.url) {
            await intent.setAvatarUrl(provisionedUser.url);
        }
    }

    private async onUserQuery(userId: string) {
        if (!this.opts.controller.onUserQuery) {
            return;
        }
        const matrixUser = new MatrixUser(userId);
        try {
            const provisionedUser = await this.opts.controller.onUserQuery(matrixUser);
            if (!provisionedUser) {
                log.warn(`Not provisioning user for ${userId}`);
                return;
            }
            await this.provisionUser(matrixUser, provisionedUser);
        }
        catch (ex) {
            log.error(`Failed _onUserQuery for ${userId}`, ex);
        }
    }

    private async onAliasQuery(alias: string) {
        if (!this.opts.controller.onAliasQuery) {
            return;
        }
        if (!this.botIntent) {
            throw Error('botIntent is not ready yet');
        }
        const aliasLocalpart = alias.split(":")[0].substring(1);
        const provisionedRoom = await this.opts.controller.onAliasQuery(alias, aliasLocalpart);
        if (!provisionedRoom) {
            // Not provisioning room.
            throw Error("Not provisioning room for this alias");
        }

        let roomId = provisionedRoom.roomId;
        // If they didn't pass an existing `roomId` back,
        // we expect some `creationOpts` to create a new room
        if (roomId === undefined) {
            roomId = await this.botIntent.botSdkIntent.underlyingClient.createRoom(
                provisionedRoom.creationOpts
            );
        }

        if (!roomId) {
            // In theory this should never be called, but typescript isn't happy.
            throw Error('Expected roomId to be truthy');
        }

        if (!this.opts.disableStores) {
            if (!this.roomStore) {
                throw Error("roomStore is not ready yet");
            }
            const matrixRoom = new MatrixRoom(roomId);
            const remoteRoom = provisionedRoom.remote;
            if (remoteRoom) {
                await this.roomStore.linkRooms(matrixRoom, remoteRoom, {});
            }
            else {
                // store the matrix room only
                await this.roomStore.setMatrixRoom(matrixRoom);
            }
        }
        if (this.opts.controller.onAliasQueried) {
            await this.opts.controller.onAliasQueried(alias, roomId);
        }
    }

    private async onEphemeralEvent(event: EphemeralEvent) {
        try {
            await this.onEphemeralActivity(event);
        }
        catch (ex) {
            log.error(`Failed to handle ephemeral activity`, ex);
        }
        if (this.opts.controller.onEphemeralEvent) {
            const request = new EphemeralMatrixRequest(event);
            this.requestFactory.withRequest(request);
            await this.opts.controller.onEphemeralEvent(request);
        }
    }

    /**
     * Find a member for a given room. This method will fetch the joined members
     * from the homeserver if the cache doesn't have it stored.
     * @param preferBot Should we prefer the bot user over a ghost user
     * @returns The userID of the member.
     */
    public async getAnyASMemberInRoom(roomId: string, preferBot = true): Promise<string|null> {
        if (!this.registration) {
            throw Error('Registration must be defined before you can call this');
        }
        let members = this.membershipCache.getMembersForRoom(roomId, "join");
        if (!members) {
            if (!this.botIntent) {
                throw Error('AS Bot not defined yet');
            }
            members = await this.botIntent.botSdkIntent.underlyingClient.getJoinedRoomMembers(roomId);
        }
        if (preferBot && members?.includes(this.botUserId)) {
            return this.botUserId;
        }
        const reg = this.registration;
        return members.find((u) => reg.isUserMatch(u, false)) || null;
    }

    private async validateEditEvent(
        event: WeakEvent, parentEventId: string, allowEventOnLookupFail: boolean): Promise<boolean> {
        try {
            const roomMember = await this.getAnyASMemberInRoom(event.room_id);
            if (!roomMember) {
                throw Error('No member in room, cannot handle edit');
            }
            const relatedEvent = await this.getIntent(roomMember).getEvent(
                event.room_id,
                parentEventId,
                true
            );
            // Only allow edits from the same sender
            if (relatedEvent.sender !== event.sender) {
                log.warn(
                `Rejecting ${event.event_id}: Message edit sender did NOT match the original message (${parentEventId})`
                );
                return false;
            }
        }
        catch (ex) {
            if (!allowEventOnLookupFail) {
                log.warn(`Rejecting ${event.event_id}: Unable to fetch parent event ${parentEventId}`, ex);
                return false;
            }
            log.warn(`Allowing event ${event.event_id}: Unable to fetch parent event ${parentEventId}`, ex);
        }
        return true;
    }

    // returns a Promise for the request linked to this event for testing.
    private async onEvent(event: WeakEvent) {
        if (!this.registration) {
            // Called before we were ready, which is probably impossible.
            return null;
        }
        if (this.selfPingDeferred?.roomId === event.room_id && event.sender === this.botUserId) {
            this.selfPingDeferred.defer.resolve();
            log.debug("Got self ping");
            return null;
        }
        const isCanonicalState = event.state_key === "";
        this.updateIntents(event);
        if (this.opts.suppressEcho &&
                (this.registration.isUserMatch(event.sender, true) ||
                event.sender === this.botUserId)) {
            return null;
        }

        if (this.activityTracker && event.sender && event.origin_server_ts) {
            this.activityTracker.setLastActiveTime(event.sender, );
        }

        // eslint-disable-next-line camelcase
        const relatesTo = event.content?.['m.relates_to'] as { event_id?: string; rel_type: "m.replace";}|undefined;
        const editOptions = this.opts.eventValidation?.validateEditSender;

        if (
            event.type === 'm.room.message' &&
            relatesTo?.rel_type === 'm.replace' &&
            relatesTo.event_id &&
            editOptions
        ) {
            // Event rejected.
            if (!await this.validateEditEvent(event, relatesTo.event_id, editOptions.allowEventOnLookupFail)) {
                return null;
            }
        }

        if (this.roomUpgradeHandler && this.opts.roomUpgradeOpts && this.appServiceBot) {
            // m.room.tombstone is the event that signals a room upgrade.
            if (event.type === "m.room.tombstone" && isCanonicalState && this.roomUpgradeHandler) {
                // eslint-disable-next-line camelcase
                this.roomUpgradeHandler.onTombstone({...event, content: event.content as {replacement_room: string}});
                if (this.opts.roomUpgradeOpts.consumeEvent) {
                    return null;
                }
            }
            else if (event.type === "m.room.member" &&
                    event.state_key === this.appServiceBot.getUserId() &&
                    (event.content as {membership: UserMembership}).membership === "invite") {
                // A invite-only room that has been upgraded won't have been joinable,
                // so we are listening for any invites to the new room.
                const isUpgradeInvite = await this.roomUpgradeHandler.onInvite(event);
                if (isUpgradeInvite &&
                    this.opts.roomUpgradeOpts.consumeEvent) {
                    return null;
                }
            }
        }

        const request = new TimelineMatrixRequest(event);
        this.requestFactory.withRequest(request);
        const contextReady = this.getBridgeContext(event);
        const dataReady = contextReady.then(context => ({ request, context }));

        const dataReadyLimited = this.limited(dataReady);

        this.queue.push(event, dataReadyLimited);
        this.queue.consume();
        const reqPromise = request.getPromise();

        // We *must* return the result of the request.
        try {
            return await reqPromise;
        }
        catch (ex) {
            if (ex instanceof EventNotHandledError) {
                this.handleEventError(event, ex);
            }
            throw ex;
        }
    }

    /**
     * Restricts the promise according to the bridges `perRequest` setting.
     *
     * `perRequest` enabled:
     *     Returns a promise similar to `promise`, with the addition of it only
     *     resolving after `request`.
     * `perRequest` disabled:
     *     Returns the promise unchanged.
     */
    private async limited<T>(promise: Promise<T>): Promise<T> {
        // queue.perRequest controls whether multiple request can be processed by
        // the bridge at once.
        if (this.opts.queue?.perRequest) {
            const promiseLimited = (async () => {
                try {
                    // We don't care about the results
                    await this.prevRequestPromise;
                }
 finally {
                    return promise;
                }
            })();
            this.prevRequestPromise = promiseLimited;
            return promiseLimited;
        }

        return promise;
    }

    private onConsume(err: Error|null, data: { request: TimelineMatrixRequest, context?: BridgeContext}|null) {
        if (err) {
            // The data for the event could not be retrieved.
            log.info("onEvent failure: " + err, true);
            return;
        }
        if (!data) {
            throw Error('Expected data to be defined if error is null');
        }

        this.opts.controller.onEvent(data.request, data.context);
    }

    // eslint-disable-next-line camelcase
    private async getBridgeContext(event: {sender: string, type: string, state_key?: string, room_id: string}) {
        if (this.opts.disableContext) {
            return null;
        }

        if (!this.roomStore || !this.userStore) {
            throw Error('Cannot call getBridgeContext before loading databases');
        }

        const context = new BridgeContext({
            sender: event.sender,
            target: event.type === "m.room.member" ? event.state_key : undefined,
            room: event.room_id
        });

        return context.get(this.roomStore, this.userStore);
    }

    // eslint-disable-next-line camelcase
    private handleEventError(event: {room_id: string, event_id: string}, error: EventNotHandledError) {
        if (!this.botIntent) {
            throw Error('Cannot call handleEventError before calling .run()');
        }
        if (!(error instanceof EventNotHandledError)) {
            error = wrapError(error, BridgeInternalError);
        }
        // TODO[V02460@gmail.com]: Send via different means when the bridge bot is
        // unavailable. _MSC2162: Signaling Errors at Bridges_ will have details on
        // how this should be done.
        this.botIntent.unstableSignalBridgeError(
            event.room_id,
            event.event_id,
            this.opts.networkName,
            error.reason,
            this.getUserRegex(),
        );
    }

    /**
     * Returns a regex matching all users of the bridge.
     * @return Super regex composed of all user regexes.
     */
    private getUserRegex(): string[] {
        // Return empty array if registration isn't available yet.
        return this.registration?.getOutput()?.namespaces?.users?.map(o => o.regex) || [];
    }

    private updateIntents(event: WeakEvent) {
        if (event.type === "m.room.member" && event.state_key) {
            const content = event.content as {
                membership: UserMembership;
                displayname?: string;
                // eslint-disable-next-line camelcase
                avatar_url?: string;
            };
            const profile: UserProfile = {};
            if (content && content.displayname) {
                profile.displayname = content.displayname;
            }
            if (content && content.avatar_url) {
                profile.avatar_url = content.avatar_url;
            }
            this.membershipCache.setMemberEntry(
                event.room_id,
                event.state_key,
                content ? content.membership : null,
                profile,
            );
        }
        else if (event.type === "m.room.power_levels") {
            const content = event.content as PowerLevelContent;
            this.setPowerLevelEntry(event.room_id, content);
        }
    }

    private setPowerLevelEntry(roomId: string, content: PowerLevelContent) {
        this.powerlevelMap.set(roomId, content);
    }

    private getPowerLevelEntry(roomId: string) {
        return this.powerlevelMap.get(roomId);
    }

    /**
     * Returns a PrometheusMetrics instance stored on the bridge, creating it first
     * if required. The instance will be registered with the HTTP server so it can
     * serve the "/metrics" page in the usual way.
     * The instance will automatically register the Matrix SDK metrics by calling
     * {PrometheusMetrics~registerMatrixSdkMetrics}.
     *
     * Ensure that `PackageInfo.getBridgeVersion` is returns the correct version before calling this,
     * as changes to the bridge version after metric instantiation will not be detected.
     *
     * @param {boolean} registerEndpoint Register the /metrics endpoint on the appservice HTTP server. Defaults to true.
     *                                   Note: `listen()` must have been called if this is true or this will throw.
     * @param {Registry?} registry Optionally provide an alternative registry for metrics.
     */
    public getPrometheusMetrics(registerEndpoint = true, registry?: Registry): PrometheusMetrics {
        if (this.metrics) {
            return this.metrics;
        }

        const metrics = this.metrics = new PrometheusMetrics(registry);

        if (this.botSdkAS) {
            metrics.registerMatrixSdkMetrics(this.botSdkAS);
        } // Else, we will set this up in initalise()
        if (registerEndpoint && this.appservice) {
            metrics.addAppServicePath(this);
        } // Else, we will add the path in listen()

        return metrics;
    }

    /**
     * A convenient shortcut to calling registerBridgeGauges() on the
     * PrometheusMetrics instance directly. This version will supply the value of
     * the matrixGhosts field if the counter function did not return it, for
     * convenience.
     * @param {PrometheusMetrics~BridgeGaugesCallback} counterFunc A function that
     * when invoked returns the current counts of various items in the bridge.
     *
     * @example
     * bridge.registerBridgeGauges(() => {
     *     return {
     *         matrixRoomConfigs: Object.keys(this.matrixRooms).length,
     *         remoteRoomConfigs: Object.keys(this.remoteRooms).length,
     *
     *         remoteGhosts: Object.keys(this.remoteGhosts).length,
     *
     *         ...
     *     }
     * })
     */
    public registerBridgeGauges(counterFunc: () => Promise<BridgeGaugesCounts>|BridgeGaugesCounts): void {
        this.getPrometheusMetrics().registerBridgeGauges(async () => {
            const counts = await counterFunc();
            if (counts.matrixGhosts !== undefined) {
                counts.matrixGhosts = Object.keys(this.intents.size).length;
            }
            if (counts.rmau !== undefined) {
                counts.rmau = this.opts.controller.userActivityTracker?.countActiveUsers().allUsers;
            }
            return counts;
        });
    }

    /**
     * Check a express Request to see if it's correctly
     * authenticated (includes the hsToken). The query parameter `access_token`
     * and the `Authorization` header are checked.
     * @returns {Boolean} True if authenticated, False if not.
     */
    public requestCheckToken(req: ExRequest): boolean {
        if (!this.registration) {
            // Bridge isn't ready yet
            return false;
        }
        if (
            req.query.access_token !== this.registration.getHomeserverToken() &&
            req.get("authorization") !== `Bearer ${this.registration.getHomeserverToken()}`
        ) {
            return false;
        }
        return true;
    }

    /**
     * Close the appservice HTTP listener, and clear all timeouts.
     * @returns Resolves when the appservice HTTP listener has stopped
     */
    public async close(): Promise<void> {
        if (this.intentLastAccessedTimeout) {
            clearTimeout(this.intentLastAccessedTimeout);
            this.intentLastAccessedTimeout = null;
        }
        if (this.appservice) {
            await this.appservice.close();
            this.appservice = undefined;
        }
        if (this.eeEventBroker) {
            this.eeEventBroker.close();
        }
    }


    public async checkHomeserverSupport(): Promise<void> {
        if (!this.botSdkAS) {
            throw Error("botSdkAS isn't ready yet");
        }
        // Min required version
        if (this.opts.bridgeEncryption) {
            // Ensure that we have support for /login
            const loginFlows: {flows: {type: string}[]} =
                await this.botSdkAS.botClient.doRequest("GET", "/_matrix/client/r0/login");
            if (!EncryptedEventBroker.supportsLoginFlow(loginFlows)) {
                throw Error(
                    'To enable support for encryption, your homeserver must support m.login.application_service.' +
                    ' This was introduced in Matrix 1.2.'
                );
            }
        }
    }

    /**
     * Check the homeserver -> appservice connection by
     * sending a ping event.
     * @param roomId The room to use as a ping check.
     * @param timeoutMs How long to wait for the ping attempt. Defaults to 60s.
     * @throws This will throw if another ping attempt is made, or if the request times out.
     * @returns The delay in milliseconds
     */
    public async pingAppserviceRoute(roomId: string, timeoutMs = BRIDGE_PING_TIMEOUT_MS): Promise<number> {
        if (!this.botIntent) {
            throw Error("botIntent isn't ready yet");
        }
        const sentTs = Date.now();
        if (this.selfPingDeferred) {
            this.selfPingDeferred.defer.reject(new Error("Another ping request is being made. Cancelling this one."))
        }
        this.selfPingDeferred = {
            defer: deferPromise(),
            roomId,
            timeout: setTimeout(() => {
                    this.selfPingDeferred?.defer.reject(new Error("Timeout waiting for ping event"))
                }, timeoutMs),
        }
        await this.botIntent.sendEvent(roomId, BRIDGE_PING_EVENT_TYPE, {
            sentTs,
        });
        await this.selfPingDeferred.defer.promise;
        clearTimeout(this.selfPingDeferred.timeout);
        return Date.now() - sentTs;
    }

    public updateRoomLinkValidatorRules(rules: Rules): void {
        this.roomLinkValidator?.updateRules(rules);
    }

    private onIntentCreate(userId: string, intentOpts: IntentOpts, encOpts?: EncryptedIntentOpts) {
        if (!this.botSdkAS) {
            throw Error('botSdkAS must be defined before onIntentCreate can be called');
        }
        const isBot = this.botUserId === userId;
        const botIntent = isBot ? this.botSdkAS.botIntent : this.botSdkAS.getIntentForUserId(userId);
        if (encOpts) {
            return new EncryptedIntent(botIntent, this.botSdkAS.botClient, intentOpts, encOpts);
        }
        return new Intent(botIntent, this.botSdkAS.botClient, intentOpts);
    }

    private onEphemeralActivity(event: EphemeralEvent) {
        if (!this.activityTracker) {
            // Not in use.
            return;
        }
        // If we see one of these events over federation, bump the
        // last active time for those users.
        let userIds: string[]|undefined = undefined;
        if (!this.activityTracker) {
            return;
        }
        if (event.type === "m.presence" && event.content.presence === "online") {
            userIds = [event.sender];
        }
        else if (event.type === "m.receipt") {
            userIds = [];
            const currentTime = Date.now();
            // The homeserver will send us a map of all userIDs => ts for each event.
            // We are only interested in recent receipts though.
            for (const eventData of Object.values(event.content).map((v) => v["m.read"])) {
                for (const [userId, { ts }] of Object.entries(eventData)) {
                    if (currentTime - ts <= RECEIPT_CUTOFF_TIME_MS) {
                        userIds.push(userId);
                    }
                }
            }
        }
        else if (event.type === "m.typing") {
            userIds = event.content.user_ids;
        }

        if (userIds) {
            for (const userId of userIds) {
                this.activityTracker.setLastActiveTime(userId);
            }
        }
    }

}

function loadDatabase<T extends BridgeStore>(path: string, Cls: new (db: Datastore) => T) {
    const defer = deferPromise<T>();
    const db = new Datastore({
        filename: path,
        autoload: true,
        onload: function(err) {
            if (err) {
                defer.reject(err);
            }
            else {
                defer.resolve(new Cls(db));
            }
        }
    });
    return defer.promise;
}
