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

/*
 * User activity storage format:
 * {
 *   mxid: "matrix_id",
 *   ts: [.. timestamps],
 *   metadata: {
 *     .. arbitrary activity-related metadata
 *   }
 * }
 * Examples:
 * {
 * {
 *   mxid: "@foo.bar.baz",
 *   ts: [1234567890, 1234534234],
 *   metadata: {
 *     active: true,
 *   }
 * }
 */
import Datastore from "nedb";
import { BridgeStore } from "./bridge-store";
import { UserActivity, UserActivitySet } from "./user-activity";

export class UserActivityStore extends BridgeStore {
    /**
     * Construct a store suitable for user bridging information.
     * @param db The connected NEDB database instance
     */
    constructor (db: Datastore) {
        super(db);
    }

    public async storeUserActivity(mxid: string, activity: UserActivity) {
        this.upsert({ mxid }, {
            ...activity,
        });
    }

    public async getActivitySet(): Promise<UserActivitySet> {
        return this.select({}).then((records: any[]) => {
            const users: {[mxid: string]: any} = {};
            for (const record of records) {
                users[record.mxid] = {
                    ts:       record.ts,
                    metadata: record.metadata,
                };
            }
            return { users } as UserActivitySet;
        });
    }
}
