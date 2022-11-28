/*
Copyright 2021 The Matrix.org Foundation C.I.C.

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
import { Logger } from "..";
const log = new Logger("UserActTracker");

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

export type UserActivitySet = Map<string, UserActivity>;

export interface UserActivity {
    ts: number[];
    metadata: UserActivityMetadata;
}

export interface UserActivityTrackerConfig {
    inactiveAfterDays: number;
    minUserActiveDays: number;
    debounceTimeMs: number;
}

// eslint-disable-next-line @typescript-eslint/no-namespace,no-redeclare
export namespace UserActivityTrackerConfig {
    export const DEFAULT: UserActivityTrackerConfig = {
        inactiveAfterDays: 31,
        minUserActiveDays: 3,
        debounceTimeMs:    0,
    };
}

export interface UserActivityState {
    dataSet: UserActivitySet;
    changed: string[];
    activeUsers: number;
}
type ChangesCallback = (state: UserActivityState) => void;

const ONE_DAY = 24 * 60 * 60 * 1000;

/**
 * Track user activity and produce summaries thereof.
 *
 * This stores (manually entered through `updateUserActivity()`) timestamps of user activity,
 * with optional metadata - which is stored once per user, not timestamped,
 * and overwritten upon each update.
 *
 * Only one timestamp is kept per day, rounded to 12 AM UTC.
 * Only the last 31 timestamps are kept, with older ones being dropped.
 *
 * In metadata, `active` is a reserved key that must not be used
 * to not interfere with UserActivityTracker's operations.
 */
export class UserActivityTracker {
    private debounceTimer: NodeJS.Timeout|undefined;
    private debouncedChangedSet = new Set<string>();

    constructor(
        private readonly config: UserActivityTrackerConfig,
        private readonly dataSet: UserActivitySet,
        private readonly onChanges?: ChangesCallback,
    ) { }

    public updateUserActivity(userId: string, metadata?: UserActivityMetadata, dateOverride?: Date): void {
        let userObject = this.dataSet.get(userId);
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
            userObject.ts = userObject.ts.sort((a, b) => b-a).slice(0, 31);
        }

        if (!userObject.metadata.active) {
            /** @var activeSince A unix timestamp in seconds since when the user was active. */
            const activeSince = (date.getTime() - (this.config.minUserActiveDays * ONE_DAY)) / 1000;
            const active = userObject.ts.filter((ts) => ts >= activeSince).length >= this.config.minUserActiveDays;
            if (active) {
                userObject.metadata.active = true;
            }
        }

        this.dataSet.set(userId, userObject);
        this.debouncedChangedSet.add(userId);
        if (!this.debounceTimer) {
            this.debounceTimer = setTimeout(() => {
                log.debug(`Notifying the listener of RMAU changes`);
                this.onChanges?.({
                    changed: Array.from(this.debouncedChangedSet),
                    dataSet: this.dataSet,
                    activeUsers: this.countActiveUsers().allUsers,
                });
                this.debounceTimer = undefined;
                this.debouncedChangedSet.clear();
            }, this.config.debounceTimeMs);
        }
    }

    /**
     * Return the number of users active within the number of days specified in `config.inactiveAfterDays`.
     *
     * It returns the total number of active users under `allUsers` in the returned object.
     * `privateUsers` represents those users with their `metadata.private` set to `true`
     */
    public countActiveUsers(dateNow?: Date): {allUsers: number; privateUsers: number;} {
        let allUsers = 0;
        let privateUsers = 0;
        const activeSince = ((dateNow?.getTime() || Date.now()) - this.config.inactiveAfterDays * ONE_DAY) / 1000;
        for (const user of this.dataSet.values()) {
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

    public getUserData(userId: string): UserActivity|undefined {
        return this.dataSet.get(userId);
    }
}
