import { Bridge } from "../bridge";
import logger from "./logging";
import PQueue from "p-queue";

const log = logger.get("BridgeStateSyncer");

const DEFAULT_SYNC_CONCURRENCY = 3;

interface Mapping {
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
}

interface MSC2364Content extends Mapping {
    bridgebot: string;
}

interface BridgeStateSyncerOpts<BridgeMappingInfo> {
    concurrency: number;
    bridgeName: string;
    getMapping: (info: BridgeMappingInfo) => Promise<Mapping>;
}

/**
 * This class will set bridge room state according to [MSC2346](https://github.com/matrix-org/matrix-doc/pull/2346)
 */
export class BridgeStateSyncer<BridgeMappingInfo> {
    public static readonly EventType = "uk.half-shot.bridge";
    private syncQueue: PQueue;
    constructor(private bridge: Bridge, private opts: BridgeStateSyncerOpts<BridgeMappingInfo>) {
        this.syncQueue = new PQueue({
            concurrency: opts.concurrency || DEFAULT_SYNC_CONCURRENCY,
        });
    }

    public async initialSync(allMappings: Record<string, BridgeMappingInfo[]>) {
        log.info("Beginning sync of bridge state events");
        Object.entries(allMappings).forEach(([roomId, mappings]) => {
            this.syncQueue.add(() => this.syncRoom(roomId, mappings));
        });
    }

    private async syncRoom(roomId: string, mappings: BridgeMappingInfo[]) {
        log.info(`Syncing ${roomId}`);
        const intent = this.bridge.getIntent();
        for (const bridgeInfoMapping of mappings) {
            const realMapping = await this.opts.getMapping(bridgeInfoMapping);
            const key = this.createStateKey(realMapping);
            const content = this.createBridgeInfoContent(realMapping);
            try {
                const eventData: MSC2364Content|null = await intent.getStateEvent(
                    roomId, BridgeStateSyncer.EventType, key, true
                );
                if (eventData !== null) { // If found, validate.
                    if (JSON.stringify(eventData) === JSON.stringify(content)) {
                        continue;
                    }
                    log.debug(`${key} for ${roomId} is invalid, updating`);
                }
            }
            catch (ex) {
                log.warn(`Encountered error when trying to sync ${roomId}`);
                break; // To be on the safe side, do not retry this room.
            }

            // Event wasn't found or was invalid, let's try setting one.
            const eventContent = this.createBridgeInfoContent(realMapping);
            try {
                await intent.sendStateEvent(
                    roomId, BridgeStateSyncer.EventType, key, eventContent as unknown as Record<string, unknown>
                );
            }
            catch (ex) {
                log.error(`Failed to update room with new state content: ${ex.message}`);
            }
        }
    }

    public async createInitialState(bridgeMappingInfo: BridgeMappingInfo) {
        const mapping = await this.opts.getMapping(bridgeMappingInfo);
        return {
            type: BridgeStateSyncer.EventType,
            content: this.createBridgeInfoContent(mapping),
            state_key: this.createStateKey(mapping),
        };
    }

    public createStateKey(mapping: Mapping) {
        const networkId = mapping.network ? mapping.network?.id.replace(/\//g, "%2F") + "/" : "";
        const channel = mapping.channel.id.replace(/\//g, "%2F");
        return `${this.opts.bridgeName}:/${networkId}${channel}`;
    }

    public createBridgeInfoContent(mapping: Mapping)
    : MSC2364Content {
        const content: MSC2364Content = {
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
}
