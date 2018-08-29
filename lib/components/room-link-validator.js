/**
 * The room link validator is used to determine if a room can be bridged.
 */
const ConfigValidator = require("./config-validator");

const VALIDATION_CACHE_LIFETIME = 30 * 60 * 1000;
const PASSED = "RLV_PASSED";
const ERROR = "RVL_ERROR";
const ERROR_USER_CONFLICT = "RVL_USER_CONFLICT";
const ERROR_CACHED = "RVL_ERROR_CACHED";

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

class RoomLinkValidator {
    /**
     * @param {string} config Config for the validator.
     * @param {string} config.ruleFile Filename for the rule file.
     * @param {string} config.rules Rules if not using a rule file, will be
     *                              overwritten if both is set.
     * @param {boolean} config.watch If true, watch a rule file for changes.
     * @param {AppServiceBot} asBot The AS bot.
     */
    constructor (config, asBot, log) {
        this.log = log;
        this.conflictCache = new Map(); // roomId => number
        this.waitingRooms = new Map(); // roomId => Promise
        this.asBot = asBot;

        if (config.ruleFile) {
            this.config = new ConfigValidator(RULE_SCHEMA);
            this.readRuleFile();
            if (config.watch) {
                this.log(`Watching for rule changes on ${ruleFile}`);
                this.config.watchForChanges(config.ruleFile, () => {
                    try {
                        readRuleFile(config.ruleFile);
                    }
                    catch (e) {
                        // Catch these because we don't want to blow up in here.
                    }
                });
            }
        }
        else if (config.rules) {
            this.rules = this.evaulateRules(config.rules);
        }
        else {
            throw new Error("Either config.ruleFile or config.rules must be set");
        }
    }

    readRuleFile(filename) {
        try {
            this.log(`Detected rule config change..`);
            const rules = this.config.validate(filename);
            if (rules === undefined) {
                throw Error("Rule file contents was undefined");
            }
            this.log(`Rule file ok, checking rules..`);
            this.rules = this.evaulateRules(rules);
            this.log(`Applied new ruleset`);
            this.conflictCache.clear();
        }
        catch (e) {
            this.log("Failed to apply new rules:", e.message, true);
            throw e;
        }
    }

    evaulateRules(rules) {
        let newRules = {userIds: {}};
        if (!rules || !rules.userIds) {
            rules = {userIds: {}};
        }
        if (!rules.userIds.conflict) {
            rules.userIds.conflict = [];
        }
        if (!rules.userIds.exempt) {
            rules.userIds.exempt = [];
        }
        newRules.userIds.conflict = rules.userIds.conflict.map(
            (regexStr) => new RegExp(regexStr)
        );
        newRules.userIds.exempt = rules.userIds.exempt.map(
            (regexStr) => new RegExp(regexStr)
        );
        return newRules;
    }

    validateRoom (roomId, cache=true) {
        const status = cache ? this._checkConflictCache(roomId) : undefined;
        if (status !== undefined) {
            return Promise.reject(status);
        }
        // Get all users in the room.
        return this.asBot.getJoinedMembers(roomId).then((joined) => {
            for (const userId of Object.keys(joined)) {
                let rule;
                let ignoreUser = false;
                for (rule of this.rules.userIds.exempt) {
                    if (rule.exec(userId) !== null) {
                        ignoreUser = true;
                        break;
                    }
                }
                if (ignoreUser) {
                    break;
                }
                for (rule of this.rules.userIds.conflict) {
                    if (rule.exec(userId) !== null) {
                        console.log(userId);
                        return false;
                    }
                }
            }
            return true;
        }).then((isValid) => {
            if (isValid) {
                return PASSED;
            }
            this.conflictCache.set(roomId, Date.now());
            throw ERROR_USER_CONFLICT;
        });
    }

    _checkConflictCache(roomId) {
        if (this.conflictCache.has(roomId)) {
            if (
                this.conflictCache.get(roomId) > (Date.now() - VALIDATION_CACHE_LIFETIME)
            ) {
                return ERROR_CACHED;
            }
            this.conflictCache.delete(roomId);
        }
    }
}

module.exports = {
    validationStatuses: {
        PASSED,
        ERROR_USER_CONFLICT,
        ERROR_CACHED,
        ERROR,
    },
    RoomLinkValidator
};
