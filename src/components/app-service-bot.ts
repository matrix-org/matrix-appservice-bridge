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

import { AppServiceRegistration } from "matrix-appservice";
import { MembershipCache, UserProfile } from "./membership-cache";
import { StateLookupEvent } from "..";
import { MatrixClient } from "matrix-bot-sdk";

/**
 * Construct an AS bot user which has various helper methods.
 * @constructor
 * @param {MatrixClient} client The client instance configured for the AS bot.
 * @param registration The registration that the bot
 * is following. Used to determine which user IDs it is controlling.
 * @param memberCache The bridges membership cache instance,
 * for storing membership the bot has discovered.
 */
export class AppServiceBot {
    private exclusiveUserRegexes: RegExp[];
    constructor (private client: MatrixClient, private userId: string, registration: AppServiceRegistration,
        private memberCache: MembershipCache) {
        // yank out the exclusive user ID regex strings
        this.exclusiveUserRegexes = [];
        const regOut = registration.getOutput();
        if (regOut?.namespaces?.users) {
            regOut.namespaces.users.forEach((userEntry) => {
                if (!userEntry.exclusive) {
                    return;
                }
                this.exclusiveUserRegexes.push(new RegExp(userEntry.regex));
            });
        }
    }

    public getClient() {
        return this.client;
    }

    public getUserId(): string {
        return this.userId;
    }

    /**
     * Get a list of joined room IDs for the AS bot.
     * @return Resolves to a list of room IDs.
     */
    public async getJoinedRooms(): Promise<string[]> {
        return (await this.client.getJoinedRooms()).joined_rooms || [];
    }

    /**
     * Get a map of joined user IDs for the given room ID. The values in the map are objects
     * with a 'display_name' and 'avatar_url' properties. These properties may be null.
     * @param roomId The room to get a list of joined user IDs in.
     * @return Resolves to a map of user ID => display_name avatar_url
     */
    public async getJoinedMembers(roomId: string) {
        // eslint-disable-next-line camelcase
        const res: {joined: Record<string, {display_name: string, avatar_url: string}>}
            = await this.client.getJoinedRoomMembers(roomId);
        if (!res.joined) {
            return {};
        }
        for (const [member, p] of Object.entries(res.joined)) {
            if (this.isRemoteUser(member)) {
                const profile: UserProfile = {};
                if (p.display_name) {
                    profile.displayname = p.display_name;
                }
                if (p.avatar_url) {
                    profile.avatar_url = p.avatar_url;
                }
                this.memberCache.setMemberEntry(roomId, member, "join", profile);
            }
        }
        return res.joined;
    }

    public async getRoomInfo(roomId: string, joinedRoom: {state?: { events: StateLookupEvent[]}} = {}) {
        const stateEvents = joinedRoom.state ? joinedRoom.state.events : [];
        const roomInfo: {id: string, state: StateLookupEvent[], realJoinedUsers: string[], remoteJoinedUsers: string[]}
         = {
            id: roomId,
            state: stateEvents,
            realJoinedUsers: [],
            remoteJoinedUsers: [],
        };
        stateEvents.forEach((event) => {
            if (event.type !== "m.room.member" || (event.content as {membership: string}).membership !== "join") {
                return;
            }
            const userId = event.state_key;
            if (userId === this.getUserId()) {
                return;
            }
            if (this.isRemoteUser(userId)) {
                roomInfo.remoteJoinedUsers.push(userId);
            }
            else {
                roomInfo.realJoinedUsers.push(userId);
            }
        });
        return roomInfo;
    }

    /**
     * Test a userId to determine if it's a user within the exclusive regexes of the bridge.
     * @return True if it is a remote user, false otherwise.
     */
    public isRemoteUser(userId: string) {
        return this.exclusiveUserRegexes.some((r) => r.test(userId));
    }
}
