import { Bridge } from "../bridge";
import { Logger } from "..";
import PQueue from "p-queue";
import { Counter, Gauge } from "prom-client";

const log = new Logger("bridge.MembershipQueue");

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
    ts: number;
    ttl: number;
}

export interface MembershipQueueOpts {
    /**
     * The number of concurrent operations to perform.
     */
    concurrentRoomLimit?: number;
    /**
     * The number of attempts to retry an operation before it is discarded.
     */
    maxAttempts?: number;
    /**
     * @deprecated Use `actionDelayMs`
     */
    joinDelayMs?: number;
    /**
     * How long to delay a request for in milliseconds, multiplied by the number of attempts made
     * if a request failed.
     */
    actionDelayMs?: number;
    /**
     * @deprecated Use `maxActionDelayMs`
     */
    maxJoinDelayMs?: number;
    /**
     * The maximum number of milliseconds a request may be delayed for.
     */
    maxActionDelayMs?: number;
    /**
     * How long a request can "live" for before it is discarded in
     * milliseconds. This will override `maxAttempts`.
     */
    defaultTtlMs?: number;
}

/**
 * Default values used by the queue if not specified.
 */
export const DEFAULT_OPTS: MembershipQueueOptsWithDefaults = {
    concurrentRoomLimit: 8,
    maxAttempts: 10,
    actionDelayMs: 500,
    maxActionDelayMs: 30 * 60 * 1000, // 30 mins
    defaultTtlMs: 2 * 60 * 1000, // 2 mins
};

interface MembershipQueueOptsWithDefaults extends MembershipQueueOpts {
    maxActionDelayMs: number;
    actionDelayMs: number;
    concurrentRoomLimit: number;
    defaultTtlMs: number;
    maxAttempts: number;
}

/**
 * This class sends membership changes for rooms in a linearized queue.
 * The queue is lineaized based upon the hash value of the roomId, so that two
 * operations for the same roomId may never happen concurrently.
 */
export class MembershipQueue {
    private queues: Map<number, PQueue> = new Map();
    private pendingGauge?: Gauge<"type"|"instance_id">;
    private processedCounter?: Counter<"type"|"instance_id"|"outcome">;
    private failureReasonCounter?: Counter<"errcode"|"http_status"|"type">;
    private ageOfLastProcessedGauge?: Gauge<string>;
    private opts: MembershipQueueOptsWithDefaults;

    constructor(private bridge: Bridge, opts: MembershipQueueOpts) {
        this.opts = { ...DEFAULT_OPTS, ...opts};
        for (let i = 0; i < this.opts.concurrentRoomLimit; i++) {
            this.queues.set(i, new PQueue({
                autoStart: true,
                concurrency: 1,
            }));
        }

        if (opts.actionDelayMs === undefined && opts.joinDelayMs) {
            log.warn("MembershipQueue configured with deprecated config option `joinDelayMs`. Use `actionDelayMs`");
            this.opts.actionDelayMs = opts.joinDelayMs;
        }

        if (opts.maxActionDelayMs === undefined && opts.maxJoinDelayMs) {
            log.warn(
                "MembershipQueue configured with deprecated config option `maxJoinDelayMs`. Use `maxActionDelayMs`"
            );
            this.opts.maxActionDelayMs = opts.maxJoinDelayMs;
        }
    }

    /**
     * This should be called after starting the bridge in order
     * to track metrics for the membership queue.
     */
    public registerMetrics() {
        const metrics = this.bridge.getPrometheusMetrics(false);

        this.pendingGauge = metrics.addGauge({
            name: "membershipqueue_pending",
            help: "Count of membership actions in the queue by type",
            labels: ["type"]
        });

        this.processedCounter = metrics.addCounter({
            name: "membershipqueue_processed",
            help: "Count of membership actions processed by type and outcome",
            labels: ["type", "outcome"],
        });

        this.failureReasonCounter = metrics.addCounter({
            name: "membershipqueue_reason",
            help: "Count of failures to process membership by type, matrix errcode and http statuscode",
            labels: ["type", "errcode", "http_status"],
        });

        this.ageOfLastProcessedGauge = metrics.addGauge({
            name: "membershipqueue_lastage",
            help: "Gauge to measure the age of the last processed event",
        });
    }

    /**
     * Join a user to a room
     * @param roomId The roomId to join
     * @param userId Leave empty to act as the bot user.
     * @param req The request entry for logging context
     * @param retry Should the request retry if it fails
     * @param ttl How long should this request remain queued in milliseconds
     * before it's discarded. Defaults to `opts.defaultTtlMs`
     * @returns A promise that resolves when the membership has completed
     */
    public async join(roomId: string, userId: string|undefined, req: ThinRequest, retry = true, ttl?: number) {
        return this.queueMembership({
            roomId,
            userId: userId || this.bridge.botUserId,
            retry,
            req,
            attempts: 0,
            type: "join",
            ts: Date.now(),
            ttl: ttl || this.opts.defaultTtlMs,
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
     * @param ttl How long should this request remain queued in milliseconds
     * before it's discarded. Defaults to `opts.defaultTtlMs`
     * @returns A promise that resolves when the membership has completed
     */
    public async leave(roomId: string, userId: string, req: ThinRequest,
                       retry = true, reason?: string, kickUser?: string,
                       ttl?: number) {
        return this.queueMembership({
            roomId,
            userId: userId || this.bridge.botUserId,
            retry,
            req,
            attempts: 0,
            reason,
            kickUser,
            type: "leave",
            ts: Date.now(),
            ttl: ttl || this.opts.defaultTtlMs,
        })
    }

    public async queueMembership(item: QueueUserItem) {
        try {
            const queue = this.queues.get(this.hashRoomId(item.roomId));
            if (!queue) {
                throw Error("Could not find queue for hash");
            }
            this.pendingGauge?.inc({
                type: item.kickUser ? "kick" : item.type
            });
            return queue.add(() => this.serviceQueue(item));
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
        const { req, roomId, userId, reason, kickUser, attempts, type, ttl, ts } = item;
        const age = Date.now() - ts;
        if (age > ttl) {
            this.processedCounter?.inc({
                type: kickUser ? "kick" : type,
                outcome: "dead",
            });
            this.pendingGauge?.dec({
                type: kickUser ? "kick" : type
            });
            throw Error('Request failed. TTL exceeded');
        }
        const reqIdStr = req.getId() ? `[${req.getId()}]`: "";
        log.debug(`${reqIdStr} ${userId}@${roomId} -> ${type} (reason: ${reason || "none"}, kicker: ${kickUser})`);
        const intent = this.bridge.getIntent(kickUser || userId);
        this.ageOfLastProcessedGauge?.set(age);
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
            this.processedCounter?.inc({
                type: kickUser ? "kick" : type,
                outcome: "success",
            });
        }
        catch (ex) {
            if (ex.body.errcode || ex.statusCode) {
                this.failureReasonCounter?.inc({
                    type: kickUser ? "kick" : type,
                    errcode: ex.body.errcode || "none",
                    http_status: ex.statusCode || "none"
                });
            }
            if (!this.shouldRetry(ex, attempts)) {
                this.processedCounter?.inc({
                    type: kickUser ? "kick" : type,
                    outcome: "fail",
                });
                throw ex;
            }
            const delay = Math.min(
                (this.opts.actionDelayMs * attempts) + (Math.random() * 500),
                this.opts.actionDelayMs
            );
            log.warn(`${reqIdStr} Failed to ${type} ${roomId}, delaying for ${delay}ms`);
            log.debug(`${reqIdStr} Failed with: ${ex.body.errcode} ${ex.message}`);
            await new Promise((r) => setTimeout(r, delay));
            this.queueMembership({...item, attempts: attempts + 1}).catch((innerEx) => {
                log.error(`Failed to handle membership change:`, innerEx);
            });
        }
        finally {
            this.pendingGauge?.dec({
                type: kickUser ? "kick" : type
            });
        }
    }

    private shouldRetry(ex: {body: {code: string; errcode: string;}, statusCode: number}, attempts: number): boolean {
        const { errcode } = ex.body;
        return !(
            attempts === this.opts.maxAttempts ||
            // Forbidden
            errcode === "M_FORBIDDEN" ||
            ex.statusCode === 403 ||
            // Not found
            ex.statusCode === 404
        );
    }
}
