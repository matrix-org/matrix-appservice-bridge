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
 * Caches membership of virtual users to rooms in memory
 * and also stores the state of whether users are registered.
 */
export type UserMembership = "join"|"invite"|"leave"|"ban"|null;
export type UserProfile = {
    displayname?: string;
    avatar_url?: string; // eslint-disable-line camelcase
}

interface CacheEntry {
    membership: UserMembership;
    profile: UserProfile;
}

export class MembershipCache {
    // Map of room ID, to map of user ID to cache entry.
    private membershipCache = new Map<string, Map<string, CacheEntry>>();
    private registeredUsers = new Set<string>();

    /**
     * Gets the *cached* state of a user's membership for a room.
     * This DOES NOT check to verify the value is correct (i.e the
     * room may have state reset and left the user from the room).
     *
     * This only caches users from the appservice.
     *
     * @param roomId Room id to check the state of.
     * @param userId The userid to check the state of.
     * @returns The membership state of the user, e.g. "joined"
     */
    public getMemberEntry(roomId: string, userId: string): UserMembership {
        const entry = this.membershipCache.get(roomId)?.get(userId);

        if (!entry) {
            return null;
        }

        return entry.membership;
    }

    /**
     * Gets the *cached* state of a user's membership for a room.
     * This DOES NOT check to verify the value is correct (i.e the
     * room may have state reset and left the user from the room).
     *
     * This only caches users from the appservice.
     *
     * @param roomId Room id to check the state of.
     * @param userId The userid to check the state of.
     * @returns The member's profile information.
     */
    public getMemberProfile(roomId: string, userId: string): UserProfile {
        const entry = this.membershipCache.get(roomId)?.get(userId);

        if (!entry) {
            return {};
        }

        return entry.profile;
    }

    /**
     * Set the *cached* state of a user's membership for a room.
     * Use this to optimise intents so that they do not attempt
     * to join a room if we know they are joined.
     * This DOES NOT set the actual membership of the room.
     *
     * This only caches users from the appservice.
     * @param roomId Room id to set the state of.
     * @param userId The userid to set the state of.
     * @param membership The membership value to set for the user
     *                       e.g joined.
     */
    public setMemberEntry(roomId: string, userId: string, membership: UserMembership, profile: UserProfile): void {
        let roomCache = this.membershipCache.get(roomId);
        if (!roomCache) {
            roomCache = new Map();
            this.membershipCache.set(roomId, roomCache);
        }

        // Bans and invites do not mean the user exists.
        if (membership === "join" || membership === "leave") {
            this.registeredUsers.add(userId);
        }

        roomCache.set(userId, {
            membership,
            profile,
        });
    }

    /**
     * Is a user considered registered with the homeserver.
     * @param userId A Matrix userId
     */
    public isUserRegistered(userId: string): boolean {
        return this.registeredUsers.has(userId);
    }

    public getMembersForRoom(roomId: string, filterFor?: UserMembership): string[]|null {
        const roomCache = this.membershipCache.get(roomId);
        if (!roomCache) {
            return null;
        }

        if (!filterFor) {
            return Array.from(roomCache.keys());
        }

        return Array.from(roomCache.entries())
            .filter(([, entry]) => entry.membership === filterFor)
            .map(([userId]) => userId);
    }
}
