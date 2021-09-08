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
const log = logging.get("BridgeBlocker");

export class BridgeBlocker {
    _isBlocked = false;

    get isBlocked(): boolean {
        return this._isBlocked;
    }

    constructor(private userLimit: number) {}

    public async checkLimits(users: number) {
        log.debug(`Bridge now serving ${users} users`);

        if (users > this.userLimit) {
            if (!this._isBlocked) {
                try {
                    await this.blockBridge()
                    log.info(`Bridge has reached the user limit of ${this.userLimit} and is now blocked`);
                } catch (err: unknown) {
                    log.error(`Failed to block the bridge: ${err}`);
                }
            }
        }
        else {
            if (this._isBlocked) {
                try {
                    await this.unblockBridge()
                    log.info(`Bridge has has gone below the user limit of ${this.userLimit} and is now unblocked`);
                } catch (err: unknown) {
                    log.error(`Failed to unblock the bridge: ${err}`);
                }
            }
        }
    }

    // overload these to implement custom (un)blocking behaviour
    public async blockBridge() {
        this._isBlocked = true;
    }

    public async unblockBridge() {
        this._isBlocked = false;
    }
}
