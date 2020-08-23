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
import { Intent } from "./intent";
import { RoomBridgeStore, RoomBridgeStoreEntry } from "./room-bridge-store";

const log = logging.get("RoomUpgradeHandler");

interface RoomUpgradeHandlerOpts {
    migrateGhosts: boolean;
    migrateStoreEntries: boolean;
    onRoomMigrated?: (oldRoomId: string, newRoomId: string) => Promise<void>|void;
    migrateEntry?: (entry: RoomBridgeStoreEntry, newRoomId: string) => Promise<RoomBridgeStoreEntry>;
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
    constructor(private readonly opts: RoomUpgradeHandlerOpts, private readonly bridge: any) {
        if (opts.migrateGhosts !== false) {
            opts.migrateGhosts = true;
        }
        if (opts.migrateStoreEntries !== false) {
            opts.migrateStoreEntries = true;
        }
    }

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
        const intent = this.bridge.getIntent() as Intent;
        try {
            await intent.join(newRoomId, joinVia);
            return true;
        }
        catch(ex) {
            if (ex.errcode === "M_FORBIDDEN") {
                return false;
            }
            throw Error("Failed to handle upgrade");
        }
    }

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
        } catch (err) {
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
                const i = this.bridge.getIntent(userId) as Intent;
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
        const roomStore = this.bridge.getRoomStore() as RoomBridgeStore;
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
                if (existingId !== newEntry.id) {
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
        entry.matrix = new MatrixRoom(newRoomId, {
            name: entry.matrix?.name,
            topic: entry.matrix?.topic,
            extras: entry.matrix?.extras || {},
        });
        return entry;
    }
}

module.exports = RoomUpgradeHandler;

 /**
  * Options to supply to the {@link RoomUpgradeHandler}.
  * @typedef RoomUpgradeHandler~Options
  * @type {Object}
  * @property {RoomUpgradeHandler~MigrateEntry} migrateEntry Called when
  * the handler wishes to migrate a MatrixRoom entry to a new room_id. If omitted,
  * {@link RoomUpgradeHandler~_migrateEntry} will be used instead.
  * @property {RoomUpgradeHandler~onRoomMigrated} onRoomMigrated This is called
  * when the entries of the room have been migrated, the bridge should do any cleanup it
  * needs of the old room and setup the new room (ex: Joining ghosts to the new room).
  * @property {bool} [consumeEvent=true] Consume tombstone or invite events that
  * are acted on by this handler.
  * @property {bool} [migrateGhosts=true] If true, migrate all ghost users across to
  * the new room.
  * @property {bool} [migrateStoreEntries=true] If true, migrate all ghost users across to
  * the new room.
  */


 /**
 * Invoked when iterating around a rooms entries. Should be used to update entries
 * with a new room id.
 *
 * @callback RoomUpgradeHandler~MigrateEntry
 * @param {RoomBridgeStore~Entry} entry The existing entry.
 * @param {string} newRoomId The new roomId.
 * @return {RoomBridgeStore~Entry} Return the entry to upsert it,
 * or null to ignore it.
 */

 /**
  * Invoked after a room has been upgraded and it's entries updated.
  *
  * @callback RoomUpgradeHandler~onRoomMigrated
  * @param {string} oldRoomId The old roomId.
  * @param {string} newRoomId The new roomId.
  */

