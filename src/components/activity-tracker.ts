import { MatrixClient } from "matrix-bot-sdk";
import * as logging from "./logging";
const log = logging.get("ActivityTracker");

export interface ActivityTrackerOpts {
    /**
     * Matrix server name. Used for determining local and remote users.
     * @example matrix.org
     */
    serverName: string;
    /**
     * Should the tracker assume offline or online if it doesn't have enough information.
     */
    defaultOnline: boolean;
    /**
     * Should presence be used. Set to false if the homeserver has presence disabled.
     */
    usePresence?: boolean;
    /**
     * Run a function when the last active time for a user gets updated
     */
    onLastActiveTimeUpdated?: (userId: string, ts: number) => void|Promise<void>
}

/**
 * This class provides a "one stop shop" to determine if a user is online. It uses a combination of a
 * local cache, presence endpoints and admin APIs in that order.
 */
export class ActivityTracker {
    private lastActiveTime: Map<string, number>;
    private canUseWhois: boolean|null = null;
    constructor(private readonly client: MatrixClient, private opts: ActivityTrackerOpts) {
        opts.usePresence = opts.usePresence !== undefined ? opts.usePresence : true;
        this.lastActiveTime = new Map();
    }


    public get usingWhois(): boolean|null {
        return this.canUseWhois;
    }

    /**
     * Sets the last active time of the user to `ts`. By default this is the current time.
     * @param userId The userId of a user who performed an action.
     * @param ts The timestamp to set in milliseconds.
     */
    public setLastActiveTime(userId: string, ts: number = Date.now()): void {
        this.lastActiveTime.set(userId, ts);
        if (this.opts.onLastActiveTimeUpdated) {
            this.opts.onLastActiveTimeUpdated(userId, ts)?.catch((ex) => {
                // Not considered fatal, but disappointing.
                log.debug(`onLastActiveTimeUpdated failed to run for ${userId}`, ex);
            });
        }
    }

    /**
     * Determine if a user is online or offline using a range of metrics.
     * @param userId The userId to check
     * @param maxTimeMs The maximum time a user may be inactive for before they are considered offline.
     * @param defaultOnline Should the user be online or offline if no data is found. Defaults to `opts.defaultOnline`
     */
    public async isUserOnline(
        userId: string, maxTimeMs: number, defaultOnline?: boolean): Promise<{online: boolean, inactiveMs: number}> {
        defaultOnline = defaultOnline === undefined ? this.opts.defaultOnline : defaultOnline;
        if (this.canUseWhois === null) {
            try {
                // HACK: Synapse exposes no way to directly determine if a user is an admin, so we use this auth check.
                await this.client.doRequest("GET", "/_synapse/admin/v1/users/@foo:bar/admin");
                this.canUseWhois = false; // This should never succeed, but prevent it from trying anyway.
            }
            catch (ex) {
                // We expect this to fail
                this.canUseWhois = (ex.statusCode === 200 || ex.statusCode === 400);
            }
        }

        // First, check if the user has bumped recently.
        const now = Date.now();
        const lastActiveTime = this.lastActiveTime.get(userId);
        if (lastActiveTime) {
            if (now - lastActiveTime < maxTimeMs) {
                // Return early, user has bumped recently.
                return {online: true, inactiveMs: now - lastActiveTime};
            }
        }
        // The user hasn't interacted with the bridge, or it was too long ago.
        // Check the user's presence.
        try {
            if (this.opts.usePresence) {
                const presence = await this.client.getPresenceStatusFor(userId);
                if (presence.currentlyActive || presence.state === "online") {
                    return {online: true, inactiveMs: presence.lastActiveAgo || 0};
                }
                else if (presence.lastActiveAgo && presence.lastActiveAgo > maxTimeMs) {
                    return {online: false, inactiveMs: presence.lastActiveAgo};
                } // Otherwise, we can't know conclusively.
            }
        }
        catch {
            // Failed to get presence, going to fallback to admin api.
        }

        const canUseWhois = this.canUseWhois && userId.split(":")[1] === this.opts.serverName;
        if (canUseWhois) {
            try {
                const whois = await this.client.adminApis.whoisUser(userId);
                const connections = Object.values(whois.devices).flatMap(
                    (device) => device.sessions.flatMap((session => session.connections))
                );
                const bestConnection = connections.sort((conA, conB) => conB.last_seen - conA.last_seen)[0];
                return {
                    online: (now - bestConnection.last_seen) < maxTimeMs, inactiveMs: now - bestConnection.last_seen
                };
            }
            catch (ex) {
                // Failed to use whois, fall back.
            }
        }

        // The user is remote, we don't have any presence for them and they've
        // not interacted with us so we are going to have to treat them as offline.
        return {online: defaultOnline, inactiveMs: -1};
    }
}
