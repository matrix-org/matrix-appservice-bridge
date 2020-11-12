import { Bridge } from "../bridge";
import { get as getLogger } from "./logging";
import PQueue from "p-queue";
import { Counter, Gauge } from "prom-client";

const log = getLogger("MembershipQueue");

export interface ThinRequest {
    getId(): string;
}

interface QueueUserItem {
    type: "join"|"leave";
    kickUser?: string;
    reason?: string;
    attempts: number;
    roomId: string;
    userId: string;
    retry: boolean;
    req: ThinRequest;
}

export interface MembershipQueueOpts {
    concurrentRoomLimit: number;
    maxAttempts: number;
    joinDelayMs: number;
    maxJoinDelayMs: number;
}

const DEFAULT_OPTS = {
    concurrentRoomLimit: 8,
    maxAttempts: 10,
    joinDelayMs: 500,
    maxJoinDelayMs: 30 * 60 * 1000, // 30 mins
};


/**
 * This class sends membership changes for rooms in a linearized queue.
 */
export class MembershipQueue {
    private queues: Map<number, PQueue> = new Map();
    private pendingGauge?: Gauge<"type"|"instance_id">;
    private processedCounter?: Counter<"type"|"instance_id"|"outcome">;

    constructor(private bridge: Bridge, private opts: MembershipQueueOpts) {
        this.opts = { ...DEFAULT_OPTS, ...this.opts};
        for (let i = 0; i < this.opts.concurrentRoomLimit; i++) {
            this.queues.set(i, new PQueue({
                autoStart: true,
                concurrency: 1,
            }));
        }
    }

    public registerMetrics() {
        const metrics = this.bridge.getPrometheusMetrics(false);

        this.pendingGauge = metrics.addGauge({
            name: "membershipqueue_pending",
            help: "Current count of configured rooms by matrix room ID",
            labels: ["type"]
        });

        this.processedCounter = metrics.addCounter({
            name: "membershipqueue_processed",
            help: "Number of membership actions processed",
            labels: ["type", "outcome"],
        });
    }

    /**
     * Join a user to a room
     * @param roomId The roomId to join
     * @param userId Leave empty to act as the bot user.
     * @param req The request entry for logging context
     * @param retry Should the request retry if it fails
     */
    public async join(roomId: string, userId: string|undefined, req: ThinRequest, retry = true) {
        return this.queueMembership({
            roomId,
            userId: userId || this.bridge.botUserId,
            retry,
            req,
            attempts: 0,
            type: "join",
        });
    }

    /**
     * Leave OR kick a user from a room
     * @param roomId The roomId to leave
     * @param userId Leave empty to act as the bot user.
     * @param req The request entry for logging context
     * @param retry Should the request retry if it fails
     * @param reason Reason for leaving/kicking
     * @param kickUser The user to be kicked. If left blank, this will be a leave.
     */
    public async leave(roomId: string, userId: string, req: ThinRequest,
                       retry = true, reason?: string, kickUser?: string) {
        return this.queueMembership({
            roomId,
            userId: userId || this.bridge.botUserId,
            retry,
            req,
            attempts: 0,
            reason,
            kickUser,
            type: "leave",
        })
    }

    public async queueMembership(item: QueueUserItem) {
        try {
            const queue = this.queues.get(this.hashRoomId(item.roomId));
            if (!queue) {
                throw Error("Could not find queue for hash");
            }
            queue.add(() => this.serviceQueue(item));
            this.pendingGauge?.inc({
                type: item.kickUser ? "kick" : item.type
            });
        }
        catch (ex) {
            log.error(`Failed to handle membership: ${ex}`);
            throw ex;
        }
    }

    private hashRoomId(roomId: string) {
        return Array.from(roomId).map((s) => s.charCodeAt(0)).reduce((a, b) => a + b, 0)
            % this.opts.concurrentRoomLimit;
    }

    private async serviceQueue(item: QueueUserItem) {
        const { req, roomId, userId, reason, kickUser, attempts, type } = item;
        const reqIdStr = req.getId() ? `[${req.getId()}]`: "";
        log.debug(`${reqIdStr} ${userId}@${roomId} -> ${type} (reason: ${reason || "none"}, kicker: ${kickUser})`);
        const intent = this.bridge.getIntent(kickUser || userId);
        try {
            if (type === "join") {
                await intent.join(roomId);
            }
            else if (kickUser) {
                await intent.kick(roomId, userId, reason);
            }
            else {
                await intent.leave(roomId, reason);
            }
            this.pendingGauge?.dec({
                type: item.kickUser ? "kick" : item.type
            });
            this.processedCounter?.inc({
                type: item.kickUser ? "kick" : item.type,
                outcome: "success",
            });
        }
        catch (ex) {
            if (!this.shouldRetry(ex, attempts)) {
                this.pendingGauge?.dec({
                    type: item.kickUser ? "kick" : item.type
                });
                this.processedCounter?.inc({
                    type: item.kickUser ? "kick" : item.type,
                    outcome: "fail",
                });
                throw ex;
            }
            const delay = Math.min(
                (this.opts.joinDelayMs * attempts) + (Math.random() * 500),
                this.opts.maxJoinDelayMs
            );
            log.warn(`${reqIdStr} Failed to ${type} ${roomId}, delaying for ${delay}ms`);
            log.debug(`${reqIdStr} Failed with: ${ex.errcode} ${ex.message}`);
            await new Promise((r) => setTimeout(r, delay));
            this.queueMembership({...item, attempts: item.attempts + 1});
        }
    }

    private shouldRetry(ex: {code: string; errcode: string; httpStatus: number}, attempts: number): boolean {
        return !(
            attempts === this.opts.maxAttempts ||
            ex.errcode === "M_FORBIDDEN" ||
            ex.httpStatus === 403
        );
    }
}
