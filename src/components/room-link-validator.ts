/*
Copyright 2020 The Matrix.org Foundation C.I.C.

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

import util from "util";
import { Logger, AppServiceBot } from "..";

const log = new Logger("bridge.RoomLinkValidator");
const VALIDATION_CACHE_LIFETIME = 30 * 60 * 1000;

export interface Rules {
    userIds: {
        exempt: RegExp[];
        conflict: RegExp[];
    };
}

/**
 * The RoomLinkValidator checks if a room should be linked to a remote
 * channel, given a set of rules supplied in a config.
 *
 * This ruleset can be hot-reloaded. Developers should call `Bridge.updateRoomLinkValidatorRules`
 * within the `CliOpts.onConfigChanged` callback to reload rules on
 * config reload.
 * @see CliOpts#onConfigChanged
 * @see Bridge#updateRoomLinkValidatorRules
 */
export class RoomLinkValidator {
    private conflictCache: Map<string, number> = new Map();
    private internalRules: Rules;

     // Public to allow unit tests to inspect it.
    public get rules(): Rules {
        return this.internalRules;
    }


    /**
     * @param config Config for the validator.
     * @param config.ruleFile Filename for the rule file.
     * @param config.rules Rules if not using a rule file, will be
     *                               overwritten if both is set.
     * @param asBot The AS bot.
     */
    constructor(config: {rules: Rules}, private asBot: AppServiceBot) {
        if (!config.rules) {
            throw new Error("config.rules must be set");
        }
        this.internalRules = this.evaluateRules(config.rules);
    }

    public updateRules(rules: Rules): void {
        this.internalRules = this.evaluateRules(rules);
    }

    private evaluateRules (rules: Rules): Rules {
        const newRules: Rules = {
            userIds: {
                conflict: [],
                exempt: [],
            }
        };
        const vettedRules: { userIds?: unknown } = (rules && typeof rules === "object") ? rules : {};
        const vettedUserIds: { conflict?: unknown, exempt?: unknown } =
            (vettedRules.userIds && typeof vettedRules.userIds === "object") ? vettedRules.userIds : {};
        if (Array.isArray(vettedUserIds.conflict)) {
            vettedUserIds.conflict.forEach((regexStr: unknown) => {
                if (typeof regexStr !== 'string' || util.types.isRegExp(regexStr)) {
                    log.warn(`All elements in userIds.conflict must be strings. Found ${typeof regexStr}.`);
                    return;
                }
                newRules.userIds.conflict.push(RegExp(regexStr));
            });
        }
        if (Array.isArray(vettedUserIds.exempt)) {
            vettedUserIds.exempt.forEach((regexStr: unknown) => {
                if (typeof regexStr !== 'string' || util.types.isRegExp(regexStr)) {
                    log.warn(`All elements in userIds.exempt must be strings. Found ${typeof regexStr}.`);
                    return;
                }
                newRules.userIds.exempt.push(RegExp(regexStr));
            });
        }
        return newRules;
    }

    public async validateRoom (roomId: string, cache=true): Promise<RoomLinkValidatorStatus> {
        const status = cache ? this.checkConflictCache(roomId) : undefined;
        if (status !== undefined) {
            throw status;
        }
        // Get all users in the room.
        const joined = await this.asBot.getJoinedMembers(roomId);
        let isValid = true;
        for (const userId of Object.keys(joined)) {
            const ignoreUser = this.rules.userIds.exempt.some(rule => rule.test(userId));
            if (ignoreUser) {
                continue;
            }
            const hasConflict = this.rules.userIds.conflict.some(rule => rule.test(userId));
            if (hasConflict) {
                isValid = false;
            }
        }
        if (isValid) {
            return RoomLinkValidatorStatus.PASSED;
        }
        this.conflictCache.set(roomId, Date.now());
        throw RoomLinkValidatorStatus.ERROR_USER_CONFLICT;
    }

    private checkConflictCache (roomId: string): RoomLinkValidatorStatus.ERROR_CACHED | undefined {
        const cacheTime = this.conflictCache.get(roomId);
        if (!cacheTime) {
            return undefined;
        }
        if (cacheTime > (Date.now() - VALIDATION_CACHE_LIFETIME)) {
            return RoomLinkValidatorStatus.ERROR_CACHED;
        }
        this.conflictCache.delete(roomId);
        return undefined;
    }
}

export enum RoomLinkValidatorStatus {
    PASSED,
    ERROR_USER_CONFLICT,
    ERROR_CACHED,
    ERROR,
}
