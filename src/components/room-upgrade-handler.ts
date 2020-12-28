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
import logging from "./logging";
import { MatrixRoom } from "../models/rooms/matrix";
import { MatrixUser } from "../models/users/matrix";
import { RoomBridgeStoreEntry } from "./room-bridge-store";
import { Bridge } from "..";

const log = logging.get("RoomUpgradeHandler");

export interface RoomUpgradeHandlerOpts {
    /**
     * Should upgrade and invite events be processed after being handled
     * by the RoomUpgradeHandler. Defaults to `false`.
     */
    consumeEvent: boolean;
    /**
     * Should ghost users be migrated to the new room. This will leave
     * any users matching the user regex list in the registration file
     * from the old room, and join them to the new room.
     * Defaults to `true`
     */
    migrateGhosts: boolean;
    /**
     * Migrate room store entries automatically. Defaults to `true`
     */
    migrateStoreEntries: boolean;

    /**
     * Invoked after a room has been upgraded and its entries updated.
     *
     * @param oldRoomId The old roomId.
     * @param newRoomId The new roomId.
     */
    onRoomMigrated?: (oldRoomId: string, newRoomId: string) => Promise<void>|void;

    /**
     * Invoked when iterating around a rooms entries. Should be used to update entries
     * with a new room id.
     *
     * @param entry The existing entry.
     * @param newRoomId The new roomId.
     * @return Return the entry to upsert it,
     * or null to ignore it.
     */
    migrateEntry?: (entry: RoomBridgeStoreEntry, newRoomId: string) => Promise<RoomBridgeStoreEntry|null>;
}

/**
 * Handles migration of rooms when a room upgrade is performed.
 */
export class RoomUpgradeHandler {
    private waitingForInvite = new Map<string, string>(); // newRoomId: oldRoomId
    /**
     * @param {RoomUpgradeHandler~Options} opts
     * @param {Bridge} bridge The parent bridge.
     */
    constructor(private readonly opts: RoomUpgradeHandlerOpts, private readonly bridge: Bridge) {
        if (opts.migrateGhosts !== false) {
            opts.migrateGhosts = true;
        }
        if (opts.migrateStoreEntries !== false) {
            opts.migrateStoreEntries = true;
        }
    }

    /**
     * Called when the bridge sees a "m.room.tombstone" event.
     * @param ev The m.room.tombstone event.
     */
    // eslint-disable-next-line camelcase
    public async onTombstone(ev: {sender: string, room_id: string, content: {replacement_room: string}}) {
        const movingTo = ev.content.replacement_room;
        log.info(`Got tombstone event for ${ev.room_id} -> ${movingTo}`);
        const joinVia = new MatrixUser(ev.sender).host;
        // Try to join the new room.
        try {
            const couldJoin = await this.joinNewRoom(movingTo, [joinVia]);
            if (couldJoin) {
                return this.onJoinedNewRoom(ev.room_id, movingTo);
            }
            this.waitingForInvite.set(movingTo, ev.room_id);
            return true;
        }
        catch (err) {
            log.error("Couldn't handle room upgrade: ", err);
            return false;
        }
    }

    private async joinNewRoom(newRoomId: string, joinVia: string[] = []) {
        const intent = this.bridge.getIntent();
        try {
            await intent.join(newRoomId, joinVia);
            return true;
        }
        catch (ex) {
            if (ex.errcode === "M_FORBIDDEN") {
                return false;
            }
            throw Error("Failed to handle upgrade");
        }
    }


    /**
     * Called when an invite event reaches the bridge. This function
     * will check if the invite is from an upgraded room, and will
     * join the room if so.
     * @param ev A Matrix m.room.member event of membership=invite
     *           directed to the bridge bot
     * @return True if the invite is from an upgraded room and shouldn't
     * be processed.
     */
    // eslint-disable-next-line camelcase
    public async onInvite(ev: {room_id: string}) {
        const oldRoomId = this.waitingForInvite.get(ev.room_id);
        if (!oldRoomId) {
            return false;
        }
        this.waitingForInvite.delete(ev.room_id);
        log.debug(`Got invite to upgraded room ${ev.room_id}`);
        try {
            await this.joinNewRoom(ev.room_id);
            await this.onJoinedNewRoom(oldRoomId, ev.room_id);
        }
        catch (err) {
            log.error("Couldn't handle room upgrade: ", err);
        }
        return true;
    }

    private async onJoinedNewRoom(oldRoomId: string, newRoomId: string) {
        log.debug(`Joined ${newRoomId}`);
        const intent = this.bridge.getIntent();
        const asBot = this.bridge.getBot();
        if (this.opts.migrateStoreEntries) {
            const success = await this.migrateStoreEntries(oldRoomId, newRoomId);
            if (!success) {
                log.error("Failed to migrate room entries. Not continuing with migration.");
                return false;
            }
        }

        log.debug(`Migrated entries from ${oldRoomId} to ${newRoomId} successfully.`);
        if (this.opts.onRoomMigrated) {
            // This may or may not be a promise, so await it.
            await this.opts.onRoomMigrated(oldRoomId, newRoomId);
        }

        if (!this.opts.migrateGhosts) {
            return false;
        }
        try {
            const members = await asBot.getJoinedMembers(oldRoomId);
            const userIds = Object.keys(members).filter((u) => asBot.isRemoteUser(u));
            log.debug(`Migrating ${userIds.length} ghosts`);
            for (const userId of userIds) {
                const i = this.bridge.getIntent(userId);
                await i.leave(oldRoomId);
                await i.join(newRoomId);
            }
            intent.leave(oldRoomId);
        }
        catch (ex) {
            log.warn("Failed to migrate ghosts", ex);
            return false;
        }
        return true;
    }

    private async migrateStoreEntries(oldRoomId: string, newRoomId: string) {
        const roomStore = this.bridge.getRoomStore();
        if (!roomStore) {
            // Do not migrate if we don't have a room store.
            return true;
        }
        const entries = await roomStore.getEntriesByMatrixId(oldRoomId);
        let success = false;
        // Upgrades are critical to get right, or a room will be stuck
        // until someone manaually intervenes. It's important to continue
        // migrating if at least one entry is successfully migrated.
        for (const entry of entries) {
            log.debug(`Migrating room entry ${entry.id}`);
            const existingId = entry.id;
            try {
                const newEntry = await (
                    this.opts.migrateEntry || this.migrateEntry)(entry, newRoomId);

                if (!newEntry) {
                    continue;
                }

                // If migrateEntry changed the id of the room, then ensure
                // that we remove the old one.
                if (existingId && existingId !== newEntry.id) {
                    await roomStore.removeEntryById(existingId);
                }
                await roomStore.upsertEntry(newEntry);
                success = true;
            }
            catch (ex) {
                log.error(`Failed to migrate room entry ${entry.id}.`);
            }
        }
        return success;
    }

    private migrateEntry(entry: RoomBridgeStoreEntry, newRoomId: string) {
        entry.matrix = new MatrixRoom(newRoomId, entry.matrix?.serialize());
        return entry;
    }
}
