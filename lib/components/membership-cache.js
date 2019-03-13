/**
 * Caches membership of virtual users to rooms in memory
 * and also stores the state of whether users are registered.
 */
class MembershipCache {
    constructor () {
        this._membershipMap = {
            // room_id: { user_id: "join|invite|leave|ban|null" }   null=unknown
        };
        this._registeredUsers = new Set();
    }

    /**
     * Get's the *cached* state of a user's membership for a room.
     * This DOES NOT check to verify the value is correct (i.e the
     * room may have state reset and left the user from the room).
     * 
     * This only caches users from the appservice.
     * 
     * @param {string}} roomId Room id to check the state of.
     * @param {string} userId The userid to check the state of.
     * @returns {string} The membership state of the user, e.g. "joined"
     */
    getMemberEntry(roomId, userId) {
        if (this._membershipMap[roomId] === undefined) {
            return null;
        }
        return this._membershipMap[roomId][userId];
    };

    /**
     * Set the *cached* state of a user's membership for a room.
     * Use this to optimise intents so that they do not attempt
     * to join a room if we know they are joined.
     * This DOES NOT set the actual membership of the room.
     * 
     * This only caches users from the appservice.
     * @param {string} roomId Room id to set the state of.
     * @param {string} userId The userid to set the state of.
     * @param {string} membership The membership value to set for the user
     *                       e.g joined.
     */
    setMemberEntry(roomId, userId, membership) {
        if (this._membershipMap[roomId] === undefined) {
            this._membershipMap[roomId] = {};
        }

        // Bans and invites do not mean the user exists.
        if (membership === "join" || membership === "leave") {
            this._registeredUsers.add(userId);
        }

        this._membershipMap[roomId][userId] = membership;
    };

    isUserRegistered(userId) {
        return this._registeredUsers.has(userId);
    }
}

module.exports = MembershipCache;
