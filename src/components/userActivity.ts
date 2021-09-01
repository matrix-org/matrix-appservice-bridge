import * as logging from "./logging";
const log = logging.get("UserActTracker");

interface UserActivityMetadata {
    /**
     * The user is active in "private" rooms. Undefined if not.
     */
    private?: true;
    /**
     * The user was previously active, so we don't have a grace period.
     */
    active?: true;
}

export interface UserActivitySet {
    users: {[userId: string]: UserActivity};
}

interface UserActivity {
    ts: number[];
    metadata: UserActivityMetadata;
}

export interface UserActivityTrackerConfig {
    inactiveAfterDays: number;
    minUserActiveDays: number;
}

export namespace UserActivityTrackerConfig {
    export const DEFAULT = {
        inactiveAfterDays: 31,
        minUserActiveDays: 3,
    };
}

interface UserActivityStorage {
    set(arg: UserActivitySet): Promise<void>;
}

const ONE_DAY = 24 * 60 * 60 * 1000;

export class UserActivityTracker {
    constructor(
        private readonly config: UserActivityTrackerConfig,
        private readonly dataSet: UserActivitySet,
        private readonly storage: UserActivityStorage,
    ) { }

    public updateUserActivity(userId: string, metadata?: UserActivityMetadata, dateOverride?: Date): void {
        let userObject = this.dataSet.users[userId];
        if (!userObject) {
            userObject = {
                ts: [],
                metadata: {},
            };
        }

        // Only store it if there are actual keys.
        userObject.metadata = { ...userObject.metadata, ...metadata };
        const date = dateOverride || new Date();

        /** @var newTs Timestamp in seconds of the current UTC day at 12 AM UTC. */
        const newTs = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0) / 1000;
        if (!userObject.ts.includes(newTs)) {
            // Always insert at the start.
            userObject.ts.unshift(newTs);
            // Slice after 31 days
            userObject.ts = userObject.ts.sort((a,b) => b-a).slice(0, 31);
        }

        if (!userObject.metadata.active) {
            /** @var activeSince A unix timestamp in seconds since when the user was active. */
            const activeSince = (date.getTime() - (this.config.minUserActiveDays * ONE_DAY)) / 1000;
            const active = userObject.ts.filter((ts) => ts >= activeSince).length >= this.config.minUserActiveDays;
            if (active) {
                userObject.metadata.active = true;
            }
        }

        this.dataSet.users[userId] = userObject;
        setImmediate(() => {
            log.debug("Committing user activity to storage");
            this.storage.set(this.dataSet).catch(
                (err) => log.error(`Failed to commit user activity`, err)
            );
        });
    }

    public countActiveUsers(dateNow?: Date): {allUsers: number; privateUsers: number;} {
        let allUsers = 0;
        let privateUsers = 0;
        const activeSince = ((dateNow?.getTime() || Date.now()) - this.config.inactiveAfterDays * ONE_DAY) / 1000;
        for (const user of Object.values(this.dataSet.users)) {
            if (!user.metadata.active) {
                continue;
            }
            const tsAfterSince = user.ts.filter((ts) => ts >= activeSince);
            if (tsAfterSince.length > 0) {
                allUsers += 1;
                if (user.metadata?.private === true) {
                    privateUsers += 1;
                }
            }
        }
        return {allUsers, privateUsers};
    }

    public getUserData(userId: string): UserActivity {
        return this.dataSet.users[userId];
    }
}
