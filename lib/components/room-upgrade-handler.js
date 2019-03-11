const log = require("./logging").get("RoomUpgradeHandler");
const MatrixRoom = require("../models/rooms/matrix");

/**
 * Get a m.room.tombstone.
 Join that room?
   Failed to join room -> retry in 30s
   Failed to join?
    - Retry again?
    - Drop room?
   Invite only?
    - Leave room in a tempoary state until invited.
 */

/**
 * Handles migration of rooms when a room upgrade is performed.
 */
class RoomUpgradeHandler {
    /**
     * @param {RoomUpgradeHandler~Options} opts
     * @param {Bridge} bridge The parent bridge.
     */
    constructor(opts, bridge) {
        this.roomsPendingUpgrade();
        this.opts = opts;
        this.bridge = bridge;
        this.waitingForInvite = new Map(); //newRoomId: oldRoomId
    }

    onTombstone(ev) {
        const movingTo = ev.content.replacement_room;
        log.info(`Got tombstone event for ${ev.room_id} -> ${movingTo}`);
        // Try to join the new room.
        this._joinNewRoom(movingTo, movingTo).then((res) => {
            return this._onJoinedNewRoom(event.room_id, movingTo);
        }).catch((err) => {
            log.error("Couldn't handle room upgrade: ", err);
            // We can wait for an invite and try again.
            this.waitingForInvite.set(movingTo, event.room_id);
        });

    }

    _joinNewRoom(newRoomId, roomIdOrAlias) {
        const intent = this.bridge.getIntent();
        intent.join(roomIdOrAlias, true, true).then((res) => {
            return;
        }).catch((ex) => {
            if (newRoomId !== roomIdOrAlias ||
                !(ex.errcode == "M_UNKNONW" && ex.error === "No known servers")) {
                // We need to wait to be invited
                throw Error("Need to wait for invite");
            }
            // RoomId is not routable, so try to get the alias and join that.
            return intent.roomState(newRoomId).then((state) => {
                const canonicalAlias = state.find(
                    (e) => e.type === "m.room.canonical_alias");
                if (canonicalAlias) {
                    log.debug(`Joining canonical alias ${canonicalAlias.content.alias}`);
                    return this._joinNewRoom(newRoomId, canonicalAlias.content.alias);
                }
                const aliases = state.filter((e) => e.type === "m.room.alias");
                if (aliases.length > 0) {
                    // Take the first one.
                    const alias = aliases[0].content.alias;
                    log.debug(`Joining first alias ${alias}`);
                    return this._joinNewRoom(newRoomId, alias);
                }
            });
        });
    }

    onInvite(ev) {
        if (!this.waitingForInvite.has(ev.room_id)) {
            return false;
        }
        const oldRoomId = this.waitingForInvite.get(ev.room_id);
        this.waitingForInvite.delete(ev.room_id);
        log.debug(`Got invite to upgraded room ${ev.room_id}`);
        this._joinNewRoom(ev.room_id, ev.room_id).then(() => {
            return this._onJoinedNewRoom(oldRoomId, ev.room_id);
        }).catch((err) => {
            log.error("Couldn't handle room upgrade: ", err);
        });
        return true;
    }

    _onJoinedNewRoom(oldRoomId, newRoomId) {
        log.debug(`Joined ${newRoomId}`);
        const intent = this.bridge.getIntent();
        return this.getRoomStore().getEntriesByMatrixId((entries) => {
            return entries.map((entry) => {
                const newEntry = (
                    this.opts.migrateEntry || this._migrateEntry)(entry, newRoomId);
                if (!newEntry) {
                    return Promise.resolve();
                }
                return this.getRoomStore().upsertEntry(newEntry);
            });
        }).then(() => {
            log.debug(`Migrated entries from ${oldRoomId} to ${newRoomId} successfully.`);
            if (this.opts.onRoomMigrated) {
                this.opts.onRoomMigrated(oldRoomId, newRoomId);
            }
            return intent.leave(oldRoomId);
        });
    }

    /**
     * [migrateEntry description]
     * @param  {[type]} entry     [description]
     * @param  {[type]} newRoomId [description]
     * @return {[type]}           [description]
     */
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
  * Returned by getUser and parseUser third-party user lookups
  * @typedef RoomUpgradeHandler~Options
  * @type {Object}
  * @property {RoomUpgradeHandler~Options~MigrateEntry} migrateEntry Called when
  * the handler wishes to migrate a MatrixRoom entry to a new room_id. If omitted,
  * {@link RoomUpgradeHandler~_migrateEntry} will be used instead.
  * @property {RoomUpgradeHandler~Options~onRoomMigrated} onRoomMigrated
  * @property {bool} [consumeEvent=true] Consume tombstone or invite events that
  * are acted on by this handler.
  */
