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
 * Room storage format:
 * {
 *   id: "matrix|remote|link_key",      // customisable
 *   matrix_id: "room_id",
 *   remote_id: "remote_room_id",
 *   matrix: { serialised matrix room info },
 *   remote: { serialised remote room info },
 *   data: { ... any additional info ... }
 * }
 *
 * Each document can either represent a matrix room, a remote room, or
 * a mapping. They look like this:
 * MATRIX
 * {
 *    id: "!room:id",
 *    matrix_id: "!room:id",
 *    matrix: { .. custom data eg name: "A happy place" .. }
 * }
 *
 * REMOTE (e.g. IRC)
 * {
 *    id: "irc.freenode.net_#channame",
 *    remote_id: "irc.freenode.net_#channame",
 *    remote: { .. custom data e.g. is_pm_room: true .. }
 * }
 *
 * MAPPING
 * {
 *    id: "!room:id__irc.freenode.net_#channame", // link key; customisable.
 *    matrix_id: "!room:id",
 *    remote_id: "irc.freenode.net_#channame",
 *    matrix: { .. custom data .. },
 *    remote: { .. custom data .. },
 *    data: { .. custom data about the mapping ..}
 * }
 *
 * A unique, non-sparse index can be set on the 'id' key, and non-unique,
 * sparse indexes can be set on matrix_id and remote_id to make mappings
 * quicker to compute.
 *
 */

import type Datastore from "nedb";
import { BridgeStore } from "./bridge-store";
import { MatrixRoom, MatrixRoomData } from "../models/rooms/matrix";
import { RemoteRoom } from "../models/rooms/remote";

export class RoomBridgeStore extends BridgeStore {
    public delimiter = "    ";

    /**
     * Construct a store suitable for room bridging information. Data is stored
     * as {@link RoomBridgeStoreEntry}s which have the following
     * *serialized* format:
     * ```
     * {
     *   id: "unique_id",      // customisable
     *   matrix_id: "room_id",
     *   remote_id: "remote_room_id",
     *   matrix: { serialised matrix room info },
     *   remote: { serialised remote room info },
     *   data: { ... any additional info ... }
     * }
     * ```
     * If a unique 'id' is not given, the store will generate one by concatenating
     * the `matrix_id` and the `remote_id`. The delimiter
     * used is a property on this store and can be modified.
     *
     * The structure of Entry objects means that it is efficient to select based
     * off the 'id', 'matrix_id' or 'remote_id'. Additional indexes can be added
     * manually.
     * @constructor
     * @param db The connected NEDB database instance
     * @param opts Options for this store.
     */
    constructor(db: Datastore) {
        super(db);
    }

    /**
     * Insert an entry, clobbering based on the ID of the entry.
     * @param entry
     */
    public upsertEntry(entry: RoomBridgeStoreEntry) {
        return this.upsert({
            id: entry.id
        }, RoomBridgeStoreEntry.serializeEntry(entry) as Record<string, unknown>);
    }

    /**
     * Get an existing entry based on the provided entry ID.
     * @param id The ID of the entry to retrieve.
     */
    public getEntryById(id: string) {
        return this.selectOne({
            id: id
        }, this.convertTo((doc: RoomStoreEntryDoc) =>
            new RoomBridgeStoreEntry(doc)
        ));
    }

    /**
     * Get a list of entries based on the matrix_id of each entry.
     * @param matrixId
     */
    public getEntriesByMatrixId(matrixId: string) {
        return this.select({
            matrix_id: matrixId
        }, this.convertTo((doc: RoomStoreEntryDoc) =>
            new RoomBridgeStoreEntry(doc)
        ));
    }

    /**
     * A batch version of <code>getEntriesByMatrixId</code>.
     * @param ids
     * @return Resolves to a map of room_id => Entry[]
     */
    public async getEntriesByMatrixIds(ids: string[]) {
        // eslint-disable-next-line camelcase
        const docs = await this.select<{ matrix_id: string }, RoomStoreEntryDoc>({
            matrix_id: {
                $in: ids
            }
        });
        if (!docs) {
            return {};
        }
        const entries: {[matrixId: string]: RoomBridgeStoreEntry[]} = {};
        docs.forEach((doc: RoomStoreEntryDoc) => {
            if (!doc.matrix_id) {
                return;
            }
            if (!entries[doc.matrix_id]) {
                entries[doc.matrix_id] = [];
            }
            entries[doc.matrix_id].push(new RoomBridgeStoreEntry(doc));
        });
        return entries;
    }

    /**
     * Get a list of entries based on the remote_id of each entry.
     * @param remoteId
     */
    public getEntriesByRemoteId(remoteId: string) {
        return this.select({
            remote_id: remoteId
        }, this.convertTo((doc: RoomStoreEntryDoc) =>
            new RoomBridgeStoreEntry(doc)
        ));
    }

    /**
     * Create a link between a matrix room and remote room. This will create an entry with:
     * - The matrix_id set to the matrix room ID.
     * - The remote_id set to the remote room ID.
     * - The id set to the id value given OR a concatenation of the matrix and remote IDs
     * if one is not provided.
     * @param matrixRoom The matrix room
     * @param remoteRoom The remote room
     * @param data Information about this mapping.
     * @param linkId The id value to set. If not given, a unique ID will be
     * created from the matrix_id and remote_id.
     */
    public linkRooms(matrixRoom: MatrixRoom, remoteRoom: RemoteRoom,
        data: Record<string, unknown>={}, linkId?: string) {
        linkId = linkId || RoomBridgeStore.createUniqueId(
            matrixRoom.getId(), remoteRoom.getId(), this.delimiter
        );
        return this.upsert({
            id: linkId
        }, {
            id: linkId,
            remote_id: remoteRoom.getId(),
            matrix_id: matrixRoom.getId(),
            remote: remoteRoom.serialize(),
            matrix: matrixRoom.serialize(),
            data: data
        });
    }

    /**
     * Create an entry with only a matrix room. Sets the 'id' of the entry to the
     * Matrix room ID. If an entry already exists with this 'id', it will be replaced.
     * This function is useful if you just want to store a room with some data and not
     * worry about any mappings.
     * @param matrixRoom
     * @see RoomBridgeStore#getMatrixRoom
     */
    public setMatrixRoom(matrixRoom: MatrixRoom) {
        const entry = new RoomBridgeStoreEntry({
            id: matrixRoom.getId(),
            matrix_id: matrixRoom.getId(),
            matrix: matrixRoom.serialize(),
        });
        return this.upsertEntry(entry);
    }

    /**
     * Get an entry's Matrix room based on the provided room_id. The entry MUST have
     * an 'id' of the room_id and there MUST be a Matrix room contained within the
     * entry for this to return.
     * @param roomId
     * @see RoomBridgeStore#setMatrixRoom
     */
    public getMatrixRoom(roomId: string) {
        return this.getEntryById(roomId).then(function(e) {
            return e ? e.matrix : null;
        });
    }

    /**
     * Get all entries with the given remote_id which have a Matrix room within.
     * @param remoteId
     */
    public async getLinkedMatrixRooms(remoteId: string) {
        const entries = await this.getEntriesByRemoteId(remoteId);
        if (!entries) {
            return [];
        }
        return entries.filter(function(e) {
            return Boolean(e.matrix);
        }).map(function(e) {
            return e.matrix;
        }) as MatrixRoom[];
    }

    /**
     * Get all entries with the given matrix_id which have a Remote room within.
     * @param matrixId
     */
    public async getLinkedRemoteRooms(matrixId: string) {
        const entries = await this.getEntriesByMatrixId(matrixId);
        if (!entries) {
            return [];
        }
        return entries.filter(function(e) {
            return Boolean(e.remote);
        }).map(function(e) {
            return e.remote;
        }) as RemoteRoom[];
    }

    /**
     * A batched version of `getLinkedRemoteRooms`.
     * @param matrixIds
     * @return A mapping of room_id to RemoteRoom.
     * @see RoomBridgeStore#getLinkedRemoteRooms
     */
    public async batchGetLinkedRemoteRooms(matrixIds: string[]) {
        const entryMap = await this.getEntriesByMatrixIds(matrixIds);
        const result: {[roomId: string]: RemoteRoom[]} = {};
        for (const [key, obj] of Object.entries(entryMap)) {
            result[key] = obj.filter((e) => {
                return Boolean(e.remote);
            }).map((e) => {
                return e.remote;
            }) as RemoteRoom[];
        }
        return result;
    }


    /**
     * Get a list of entries based on a RemoteRoom data value.
     * @param data The data values to retrieve based from.
     * @example
     * remoteRoom.set("some_key", "some_val");
     * // store remoteRoom and then:
     * store.getEntriesByRemoteRoomData({
     *     some_key: "some_val"
     * });
     */
    public getEntriesByRemoteRoomData(data: Record<string, unknown>) {
        Object.keys(data).forEach(function(k) {
            const query = data[k];
            delete data[k];
            data["remote." + k] = query;
        });
        return this.select(data, this.convertTo((doc: RoomStoreEntryDoc) =>
            new RoomBridgeStoreEntry(doc)
        ));
    }

    /**
     * Get a list of entries based on a MatrixRoom data value.
     * @param data The data values to retrieve based from.
     * @example
     * matrixRoom.set("some_key", "some_val");
     * // store matrixRoom and then:
     * store.getEntriesByMatrixRoomData({
     *     some_key: "some_val"
     * });
     */
    public getEntriesByMatrixRoomData(data: Record<string, unknown>) {
        Object.keys(data).forEach(function(k) {
            const query = data[k];
            delete data[k];
            data["matrix.extras." + k] = query;
        });
        return this.select(data, this.convertTo((doc: RoomStoreEntryDoc) =>
        new RoomBridgeStoreEntry(doc)
    ));
    }

    /**
     * Get a list of entries based on the link's data value.
     * @param data The data values to retrieve based from.
     * @example
     * store.linkRooms(matrixRoom, remoteRoom, { some_key: "some_val" });
     * store.getEntriesByLinkData({
     *     some_key: "some_val"
     * });
     */
    public getEntriesByLinkData(data: Record<string, unknown>) {
        Object.keys(data).forEach(function(k) {
            const query = data[k];
            delete data[k];
            data["data." + k] = query;
        });
        return this.select(data, this.convertTo((doc: RoomStoreEntryDoc) =>
            new RoomBridgeStoreEntry(doc)
        ));
    }

    /**
     * Remove entries based on remote room data.
     * @param data The data to match.
     * @example
     * remoteRoom.set("a_key", "a_val");
     * // store remoteRoom and then:
     * store.removeEntriesByRemoteRoomData({
     *     a_key: "a_val"
     * });
     */
    public removeEntriesByRemoteRoomData(data: Record<string, unknown>) {
        Object.keys(data).forEach(function(k) {
            const query = data[k];
            delete data[k];
            data["remote." + k] = query;
        });
        return this.delete(data);
    }

    /**
     * Remove entries with this remote room id.
     * @param remoteId The remote id.
     * @example
     * new RemoteRoom("foobar");
     * // store the RemoteRoom and then:
     * store.removeEntriesByRemoteRoomId("foobar");
     */
    public removeEntriesByRemoteRoomId(remoteId: string) {
        return this.delete({
        remote_id: remoteId
        });
    }

    /**
     * Remove entries based on matrix room data.
     * @param data The data to match.
     * @example
     * matrixRoom.set("a_key", "a_val");
     * // store matrixRoom and then:
     * store.removeEntriesByMatrixRoomData({
     *     a_key: "a_val"
     * });
     */
    public removeEntriesByMatrixRoomData(data: Record<string, unknown>) {
        Object.keys(data).forEach(function(k) {
            const query = data[k];
            delete data[k];
            data["matrix.extras." + k] = query;
        });
        return this.delete(data);
    }

    /**
     * Remove entries with this matrix room id.
     * @param matrixId The matrix id.
     * @example
     * new MatrixRoom("!foobar:matrix.org");
     * // store the MatrixRoom and then:
     * store.removeEntriesByMatrixRoomId("!foobar:matrix.org");
     */
    public removeEntriesByMatrixRoomId(matrixId: string) {
        return this.delete({
        matrix_id: matrixId
        });
    }

    /**
     * Remove entries based on the link's data value.
     * @param data The data to match.
     * @example
     * store.linkRooms(matrixRoom, remoteRoom, { a_key: "a_val" });
     * store.removeEntriesByLinkData({
     *     a_key: "a_val"
     * });
     */
    public removeEntriesByLinkData(data: Record<string, unknown>) {
        Object.keys(data).forEach(function(k) {
            const query = data[k];
            delete data[k];
            data["data." + k] = query;
        });
        return this.delete(data);
    }

    /**
     * Remove an existing entry based on the provided entry ID.
     * @param id The ID of the entry to remove.
     * @example
     * store.removeEntryById("anid");
     */
    public removeEntryById(id: string) {
        return this.delete({ id });
    }


    public static createUniqueId(matrixRoomId: string, remoteRoomId: string, delimiter: string) {
        return (matrixRoomId || "") + delimiter + (remoteRoomId || "");
    }
}

interface RoomStoreEntryDoc {
    id?: string;
    // eslint-disable-next-line camelcase
    remote_id?: string;
    // eslint-disable-next-line camelcase
    matrix_id?: string;
    remote?: Record<string, unknown>;
    matrix?: MatrixRoomData;
    data?: Record<string, unknown>;
}

export class RoomBridgeStoreEntry {
    public id?: string;
    public matrix?: MatrixRoom;
    public remote?: RemoteRoom;
    public data: Record<string, unknown>;
    constructor(doc?: RoomStoreEntryDoc) {
        this.id = doc?.id || undefined;
        // eslint-disable-next-line camelcase
        this.matrix = doc?.matrix_id ? new MatrixRoom(doc.matrix_id, doc.matrix) : undefined;
        // eslint-disable-next-line camelcase
        this.remote = doc?.remote_id ? new RemoteRoom(doc.remote_id, doc.remote) : undefined;
        this.data = doc?.data || {};
    }

    // not a member function so callers can provide a POJO
    public static serializeEntry(entry: RoomBridgeStoreEntry): RoomStoreEntryDoc {
        return {
            id: entry.id,
            remote_id: entry.remote ? entry.remote.getId() : undefined,
            matrix_id: entry.matrix ? entry.matrix.getId() : undefined,
            remote: entry.remote ? entry.remote.serialize() : undefined,
            matrix: entry.matrix ? entry.matrix.serialize() : undefined,
            data: entry.data || undefined,
        }
    }
}
