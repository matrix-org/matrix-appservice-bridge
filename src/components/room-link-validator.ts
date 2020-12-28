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

/**
 * The room link validator is used to determine if a room can be bridged.
 */
import util from "util";
import { AppServiceBot } from "./app-service-bot";
import { ConfigValidator } from "./config-validator";
import logging from "./logging";
const log = logging.get("room-link-validator");
const VALIDATION_CACHE_LIFETIME = 30 * 60 * 1000;

const RULE_SCHEMA = {
    "$schema": "http://json-schema.org/draft-04/schema#",
    type: "object",
    properties: {
        userIds: {
            type: "object",
            properties: {
                exempt: {
                    type: "array",
                    items: {
                        type: "string"
                    }
                },
                conflict: {
                    type: "array",
                    items: {
                        type: "string"
                    }
                }
            }
        }
    }
};

const VALIDATOR = new ConfigValidator(RULE_SCHEMA);

export interface Rules {
    userIds: {
        exempt: RegExp[];
        conflict: RegExp[];
    };
}

/**
 * The RoomLinkValidator checks if a room should be linked to a remote
 * channel, given a set of rules supplied in a config. The ruleset is maintained
 * in a separate config from the bridge config. It can be reloaded by triggering
 * an endpoint specified in the {@link Bridge} class.
 */
export class RoomLinkValidator {
    private conflictCache: Map<string, number> = new Map();
    private ruleFile?: string;
    public readonly rules: Rules; // Public to allow unit tests to inspect it.

    /**
     * @param config Config for the validator.
     * @param config.ruleFile Filename for the rule file.
     * @param config.rules Rules if not using a rule file, will be
     *                               overwritten if both is set.
     * @param asBot The AS bot.
     */
    constructor(config: {ruleFile?: string, rules?: Rules}, private asBot: AppServiceBot) {
        if (config.ruleFile) {
            this.ruleFile = config.ruleFile;
            this.rules = this.readRuleFile();
        }
        else if (config.rules) {
            this.rules = this.evaluateRules(config.rules);
        }
        else {
            throw new Error("Either config.ruleFile or config.rules must be set");
        }
    }

    public readRuleFile (filename?: string) {
        filename = filename || this.ruleFile;
        if (!filename) {
            throw new Error("No filename given and config is not using a file");
        }
        log.info(`Detected rule config change...`);
        const rules = VALIDATOR.validate(filename);
        if (rules === undefined) {
            throw Error("Rule file contents was undefined");
        }
        log.info(`Rule file ok, checking rules...`);
        const evaluatedRules = this.evaluateRules(rules);
        log.info(`Applied new ruleset`);
        this.conflictCache.clear();
        return evaluatedRules;
    }

    private evaluateRules (rules: unknown): Rules {
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
