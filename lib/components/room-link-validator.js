/**
 * The room link validator is used to determine if a room can be bridged
 * 
 */

const VALIDATION_CACHE_LIFETIME = 30 * 60 * 1000;
const STATUS_PASSED = "RLV_PASSED";
const STATUS_ERROR = "RVL_ERROR";
const STATUS_ERROR_CACHED = "RVL_ERROR_CACHED";

class RoomLinkValidator {
    /**
     * 
     * @param {object} rules A set of rules for the linked rooms to follow.
     * @param {string[]} rules.userIds.conflict An array of userid regexes that this bridge will conflict with.
     * @param {string[]} rules.userIds.exempt An array of userid regexes that will never conflict.
     * @param {AppServiceBot} asBot The AS bot.
     * @param {*} onEventCb Callback for onEvent.
     */
    constructor (rules, asBot, onEventCb) {
        this.rules = rules;
        if (!this.rules.userIds) {
            this.rules.userIds = {

            };
        }
        if (!this.rules.userIds.conflicting) { 
            this.rules.userIds.conflict = [];
        }
        if (!this.rules.userIds.exempt) { 
            this.rules.userIds.exempt = [];
        }
        this.conflictCache = new Map(); // roomId => checktime
        this.waitingRooms = new Map(); // roomId => Promise;
    }

    validateRoom (roomId) {
        let status = this._checkConflictCache(roomId);
        if (status !== undefined) {
            return Promise.reject(status);
        }
        // Get all users in the room.
        return this.asBot.getJoinedMembers(roomId).then((res) => {
            Object.keys(res.joined).forEach((userId) => {
                this.rules.userIds.conflicting.
            });
        });
    }

    _checkConflictCache(roomId) {
        if (this.conflictCache.has(roomId)) {
            if (this.conflictCache.get(roomId) > (Date.now() - VALIDATION_CACHE_LIFETIME)) {
                return {status: STATUS_ERROR_CACHED, msg: "Room is cached as conflicting"};
            }
            this.conflictCache.delete(roomId);
        }
    }

    _checkUserIdAgainstRules() {

    }
}
module.exports = {
    STATUS_PASSED,
    STATUS_ERROR_CACHED,
    STATUS_ERROR,
    RoomLinkValidator
}