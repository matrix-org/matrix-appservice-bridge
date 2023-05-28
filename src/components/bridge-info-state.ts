import { Bridge } from "../bridge";
import { Logger } from "..";
import { Intent } from "./intent";
import PQueue from "p-queue";

const log = new Logger("BridgeStateSyncer");
export interface MappingInfo {
    creator?: string;
    protocol: {
        id: string;
        displayname?: string;
        // eslint-disable-next-line camelcase
        avatar_url?: `mxc://${string}`;
        // eslint-disable-next-line camelcase
        external_url?: string;
    };
    network?: {
        id: string;
        displayname?: string;
        // eslint-disable-next-line camelcase
        avatar_url?: `mxc://${string}`;
        // eslint-disable-next-line camelcase
        external_url?: string;
    };
    channel: {
        id: string;
        displayname?: string;
        // eslint-disable-next-line camelcase
        avatar_url?: `mxc://${string}`;
        // eslint-disable-next-line camelcase
        external_url?: string;
    };
    eventFeatures?: MSC3968Content;
}

export interface MSC2346Content extends MappingInfo {
    bridgebot: string;
}

export interface MSC3968Content {
    keys_default?: number,
    keys?: Record<string, number>,
    html_elements_default?: number,
    html_elements?: Record<string, number>
    mimetypes_default?: number,
    mimetypes?: Record<string, number>
    msgtypes_default?: number,
    msgtypes?: Record<string, number>
}

export interface InitialEvent {
    type: string,
    content: Record<string, unknown>,
    state_key: string,
}


interface Opts<BridgeMappingInfo> {
    /**
     * The name of the bridge implementation, ideally in Java package naming format:
     * @example org.matrix.matrix-appservice-irc
     */
    bridgeName: string;
    /**
     * This should return some standard information about a given
     * mapping.
     */
    getMapping: (roomId: string, info: BridgeMappingInfo) => Promise<MappingInfo>;
}

/**
 * This class ensures that rooms contain a valid bridge info
 * event ([MSC2346](https://github.com/matrix-org/matrix-doc/pull/2346))
 * which displays the connected protocol, network and room.
 */
export class BridgeInfoStateSyncer<BridgeMappingInfo> {
    public static readonly EventType = "uk.half-shot.bridge";
    public static readonly EventFeaturesEventType = "org.matrix.msc3968.room.event_features";
    constructor(private bridge: Bridge, private opts: Opts<BridgeMappingInfo>) {
    }

    /**
     * Check all rooms and ensure they have correct state.
     * @param allMappings All bridged room mappings
     * @param concurrency How many rooms to handle at a time, defaults to 3.
     */
    public async initialSync(allMappings: Record<string, BridgeMappingInfo[]>, concurrency = 3): Promise<void> {
        log.info("Beginning sync of bridge state events");
        const syncQueue = new PQueue({ concurrency });
        Object.entries(allMappings).forEach(([roomId, mappings]) => {
            syncQueue.add(() => this.syncRoom(roomId, mappings));
        });
        return syncQueue.onIdle();
    }

    private async syncRoom(roomId: string, mappings: BridgeMappingInfo[]) {
        log.info(`Syncing ${roomId}`);
        const intent = this.bridge.getIntent();
        for (const mappingInfo of mappings) {
            const realMapping = await this.opts.getMapping(roomId, mappingInfo);
            const key = this.createStateKey(realMapping);
            const bridgeInfoContent = this.createBridgeInfoContent(realMapping);
            const eventFeaturesContent = this.getEventFeaturesContent(realMapping);
            if (!await this.syncRoomStateEvent(
                intent,
                roomId,
                BridgeInfoStateSyncer.EventType,
                key,
                bridgeInfoContent as unknown as Record<string, unknown>)
               ) {
                break;
            }
            if (eventFeaturesContent) {
                await this.syncRoomStateEvent(
                    intent,
                    roomId,
                    BridgeInfoStateSyncer.EventFeaturesEventType,
                    key,
                    eventFeaturesContent as unknown as Record<string, unknown>
                );
            }
        }
    }

    /* Sets a state event if needed
     * @return Whether syncing this room should proceeded
     */
    private async syncRoomStateEvent(
        intent: Intent,
        roomId: string,
        eventType: string,
        stateKey: string,
        eventContent: Record<string, unknown>
    ): Promise<boolean> {
        try {
            const eventData: Map<string, unknown>|null = await intent.getStateEvent(
                roomId, eventType, stateKey, true
            );
            if (eventData !== null) { // If found, validate.
                if (JSON.stringify(eventData) === JSON.stringify(eventContent)) {
                    return true;
                }
                log.debug(`${stateKey} for ${roomId} is invalid, updating`);
            }
        }
        catch (ex) {
            log.warn(`Encountered error when trying to sync ${roomId}`, ex);
            return false; // To be on the safe side, do not retry this room.
        }

        // Event wasn't found or was invalid, let's try setting one.
        try {
            await intent.sendStateEvent(
                roomId, eventType, stateKey, eventContent
            );
        }
        catch (ex) {
            log.error(
                `Failed to update room with new state content: ${ex instanceof Error ? ex.message : ex}`
            );
        }

        return true;
    }

    public async createInitialState(roomId: string, bridgeMappingInfo: BridgeMappingInfo): Promise<InitialEvent[]> {
        const mapping = await this.opts.getMapping(roomId, bridgeMappingInfo);
        const events = [
            {
                type: BridgeInfoStateSyncer.EventType,
                content: this.createBridgeInfoContent(mapping) as unknown as Record<string, unknown>,
                state_key: this.createStateKey(mapping),
            },
        ];

        const eventFeaturesContent = this.getEventFeaturesContent(mapping)
        if (eventFeaturesContent) {
            events.push({
                type: BridgeInfoStateSyncer.EventFeaturesEventType,
                content: eventFeaturesContent as unknown as Record<string, unknown>,
                state_key: this.createStateKey(mapping),
            });
        }

        return events;
    }

    public createStateKey(mapping: MappingInfo) {
        const networkId = mapping.network ? mapping.network?.id.replace(/\//g, "%2F") + "/" : "";
        const channel = mapping.channel.id.replace(/\//g, "%2F");
        return `${this.opts.bridgeName}:/${networkId}${channel}`;
    }

    public createBridgeInfoContent(mapping: MappingInfo)
    : MSC2346Content {
        const content: MSC2346Content = {
            bridgebot: this.bridge.botUserId,
            protocol: mapping.protocol,
            channel: mapping.channel,
        };
        if (mapping.creator) {
            content.creator = mapping.creator;
        }
        if (mapping.network) {
            content.network = mapping.network;
        }
        return content;
    }

    public getEventFeaturesContent(mapping: MappingInfo)
    : MSC3968Content|null {
        return mapping?.eventFeatures ?? null;
    }
}
