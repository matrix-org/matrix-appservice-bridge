const log = require("./logging").get("RoomUpgradeHandler");
const MatrixRoom = require("../models/rooms/matrix");
const MatrixUser = require("../models/users/matrix");

/**
 * Handles migration of rooms when a room upgrade is performed.
 */
class RoomUpgradeHandler {
    /**
     * @param {RoomUpgradeHandler~Options} opts
     * @param {Bridge} bridge The parent bridge.
     */
    constructor(opts, bridge) {
        this._opts = opts;
        this._bridge = bridge;
        this._waitingForInvite = new Map(); //newRoomId: oldRoomId
    }

    onTombstone(ev) {
        const movingTo = ev.content.replacement_room;
        log.info(`Got tombstone event for ${ev.room_id} -> ${movingTo}`);
        const joinVia = new MatrixUser(ev.sender).domain;
        // Try to join the new room.
        return this._joinNewRoom(movingTo, [joinVia]).then((couldJoin) => {
            if (couldJoin) {
                return this._onJoinedNewRoom(ev.room_id, movingTo);
            }
            this._waitingForInvite.set(movingTo, ev.room_id);
            return true;
        }).catch((err) => {
            log.error("Couldn't handle room upgrade: ", err);
            return false;
        });
    }

    _joinNewRoom(newRoomId, joinVia=[]) {
        const intent = this._bridge.getIntent();
        return intent.join(newRoomId, [joinVia]).then(() => {
            return true;
        }).catch((ex) => {
            if (ex.errcode === "M_FORBIDDEN") {
                return false;
            }
            throw Error("Failed to handle upgrade");
        })
    }

    onInvite(ev) {
        if (!this._waitingForInvite.has(ev.room_id)) {
            return false;
        }
        const oldRoomId = this._waitingForInvite.get(ev.room_id);
        this._waitingForInvite.delete(ev.room_id);
        log.debug(`Got invite to upgraded room ${ev.room_id}`);
        this._joinNewRoom(ev.room_id).then(() => {
            return this._onJoinedNewRoom(oldRoomId, ev.room_id);
        }).catch((err) => {
            log.error("Couldn't handle room upgrade: ", err);
        });
        return true;
    }

    _onJoinedNewRoom(oldRoomId, newRoomId) {
        log.debug(`Joined ${newRoomId}`);
        const intent = this._bridge.getIntent();
        return this.getRoomStore().getEntriesByMatrixId((entries) => {
            return entries.map((entry) => {
                const newEntry = (
                    this._opts.migrateEntry || this._migrateEntry)(entry, newRoomId);
                if (!newEntry) {
                    return Promise.resolve();
                }
                return this.getRoomStore().upsertEntry(newEntry);
            });
        }).then(() => {
            log.debug(`Migrated entries from ${oldRoomId} to ${newRoomId} successfully.`);
            if (this._opts.onRoomMigrated) {
                this._opts.onRoomMigrated(oldRoomId, newRoomId);
            }
            return intent.leave(oldRoomId);
        });
    }

    _migrateEntry(entry, newRoomId) {
        entry.matrix = new MatrixRoom(newRoomId, {
            name: entry.name,
            topic: entry.topic,
            extras: entry._extras,
        });
        return entry;
    }
}

module.exports = RoomUpgradeHandler;


/**
 * Invoked when iterating around a rooms entries. Should be used to update entries
 * with a new room id.
 * @callback RoomUpgradeHandler~Options~MigrateEntry
 * @param {RoomBridgeStore~Entry} entry The existing entry.
 * @param {string} newRoomId The new roomId.
 * @return {RoomBridgeStore~Entry|null} Return the entry to upsert it,
 * or null to ignore it.
 */

 /**
  * Invoked after a room has been upgraded and it's entries updated.
  * @callback RoomUpgradeHandler~Options~onRoomMigrated
  * @param {string} oldRoomId The old roomId.
  * @param {string} newRoomId The new roomId.
  */

 /**
  * Options to supply to the {@link RoomUpgradeHandler}.
  * @typedef RoomUpgradeHandler~Options
  * @type {Object}
  * @property {RoomUpgradeHandler~Options~MigrateEntry} migrateEntry Called when
  * the handler wishes to migrate a MatrixRoom entry to a new room_id. If omitted,
  * {@link RoomUpgradeHandler~_migrateEntry} will be used instead.
  * @property {RoomUpgradeHandler~Options~onRoomMigrated} onRoomMigrated This is called
  * when the entries of the room have been migrated, the bridge should do any cleanup it
  * needs of the old room and setup the new room (ex: Joining ghosts to the new room).
  * @property {bool} [consumeEvent=true] Consume tombstone or invite events that
  * are acted on by this handler.
  */
