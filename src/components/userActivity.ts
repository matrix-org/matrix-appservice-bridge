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

// eslint-disable-next-line @typescript-eslint/no-namespace,no-redeclare
export namespace UserActivitySet {
    export const DEFAULT: UserActivitySet = {
        users: {}
    };
}

interface UserActivity {
    ts: number[];
    metadata: UserActivityMetadata;
}

export interface UserActivityTrackerConfig {
    inactiveAfterDays: number;
    minUserActiveDays: number;
}

// eslint-disable-next-line @typescript-eslint/no-namespace,no-redeclare
export namespace UserActivityTrackerConfig {
    export const DEFAULT: UserActivityTrackerConfig = {
        inactiveAfterDays: 31,
        minUserActiveDays: 3,
    };
}

export interface UserActivityState {
    dataSet: UserActivitySet;
    activeUsers: number;
}
type ChangesCallback = (state: UserActivityState) => void;

const ONE_DAY = 24 * 60 * 60 * 1000;

export class UserActivityTracker {
    constructor(
        private readonly config: UserActivityTrackerConfig,
        private readonly dataSet: UserActivitySet,
        private readonly onChanges?: ChangesCallback,
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

        this.dataSet.users[userId] = userObject;
        setImmediate(() => {
            log.debug("Notifying the listener of RMAU changes");
            this.onChanges?.({
                dataSet: this.dataSet,
                activeUsers: this.countActiveUsers().allUsers,
            });
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
