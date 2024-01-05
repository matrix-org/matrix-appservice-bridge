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

/*
 * User storage format:
 * {
 *   type: "matrix|remote",
 *   id: "user_id|remote_id",
 *   data: {
 *     .. matrix-specific info e.g. display name ..
 *     .. remote specific info e.g. IRC username ..
 *   }
 * }
 * Examples:
 * {
 *   type: "matrix",
 *   id: "@foo:bar",
 *   data: {
 *     localpart: "foo",      // Required.
 *     displayName: "Foo Bar" // Optional.
 *   }
 * }
 *
 * {
 *   type: "remote",
 *   id: "foobar@irc.freenode.net",
 *   data: {
 *     nickChoices: ["foobar", "foobar_", "foobar__"]
 *   }
 * }
 *
 * There is also a third type, the "union" type. This binds together a single
 * matrix <--> remote pairing. A single remote ID can have many matrix_id and
 * vice versa, via mutliple union entries.
 *
 * {
 *   type: "union",
 *   remote_id: "foobar@irc.freenode.net",
 *   matrix_id: "@foo:bar"
 * }
 */
import type Datastore from "nedb";
import { BridgeStore } from "./bridge-store";
import { MatrixUser } from "../models/users/matrix";
import { RemoteUser } from "../models/users/remote";

export class UserBridgeStore extends BridgeStore {
    /**
     * Construct a store suitable for user bridging information.
     * @param db The connected NEDB database instance
     */
    constructor (db: Datastore) {
        super(db);
    }

    /**
     * Retrieve a list of corresponding remote users for the given matrix user ID.
     * @param userId The Matrix user ID
     * @return Resolves to a list of Remote users.
     */
    public async getRemoteUsersFromMatrixId(userId: string) {
        const remoteIds = await this.select({
            type: "union",
            matrix_id: userId
            // eslint-disable-next-line camelcase
        }, this.convertTo((doc: {remote_id: string}) => {
            return doc.remote_id;
        }))

        return this.select({
            type: "remote",
            id: { $in: remoteIds }
        }, this.convertTo((doc: {id: string, data: Record<string, unknown>}) =>
            new RemoteUser(doc.id, doc.data)
        ));
    }

    /**
     * Retrieve a list of corresponding matrix users for the given remote ID.
     * @param remoteId The Remote ID
     * @return Resolves to a list of Matrix users.
     */
    public async getMatrixUsersFromRemoteId(remoteId: string) {
        const matrixUserIds = await this.select({
            type: "union",
            remote_id: remoteId
            // eslint-disable-next-line camelcase
        }, this.convertTo((doc: {matrix_id: string}) => {
            return doc.matrix_id;
        }));

        return this.select({
            type: "matrix",
            id: { $in: matrixUserIds }
        }, this.convertTo((doc: {id: string, data: Record<string, unknown>}) =>
            new MatrixUser(doc.id, doc.data)
        ));
}

    /**
     * Retrieve a MatrixUser based on their user ID localpart. If there is more than
     * one match (e.g. same localpart, different domains) then this will return an
     * arbitrary matching user.
     * @param localpart The user localpart
     * @return Resolves to a MatrixUser or null.
     */
    public getByMatrixLocalpart(localpart: string) {
        return this.selectOne({
            type: "matrix",
            "data.localpart": localpart
        }, this.convertTo((doc: {id: string, data: Record<string, unknown>}) =>
            new MatrixUser(doc.id, doc.data)
        ));
    }

    /**
     * Get a matrix user by their user ID.
     * @param userId The user_id
     * @return Resolves to the user or null if they
     * do not exist. Rejects with an error if there was a problem querying the store.
     */
    public getMatrixUser(userId: string) {
        return this.selectOne({
            type: "matrix",
            id: userId
        }, this.convertTo((doc: {id: string, data: Record<string, unknown>}) =>
            new MatrixUser(doc.id, doc.data)
        ));
    }

    /**
     * Store a Matrix user. If they already exist, they will be updated. Equivalence
     * is determined by their user ID.
     * @param matrixUser The matrix user
     */
    public setMatrixUser(matrixUser: MatrixUser) {
        return this.upsert({
            type: "matrix",
            id: matrixUser.getId()
        }, {
            type: "matrix",
            id: matrixUser.getId(),
            data: matrixUser.serialize()
        });
    }

    /**
     * Get a remote user by their remote ID.
     * @param id The remote ID
     * @return Resolves to the user or null if they
     * do not exist. Rejects with an error if there was a problem querying the store.
     */
    public getRemoteUser(id: string) {
        return this.selectOne({
            type: "remote",
            id: id
        }, this.convertTo((doc: {id: string, data: Record<string, unknown>}) =>
            new RemoteUser(doc.id, doc.data)
        ));
    }

    /**
     * Get remote users by some data about them, previously stored via the set
     * method on the Remote user.
     * @param dataQuery The keys and matching values the remote users share.
     * This should use dot notation for nested types. For example:
     * <code> { "topLevel.midLevel.leaf": 42, "otherTopLevel": "foo" } </code>
     * @return Resolves to a possibly empty list of
     * RemoteUsers. Rejects with an error if there was a problem querying the store.
     * @throws If dataQuery isn't an object.
     * @example
     * remoteUser.set({
     *   toplevel: "foo",
     *   nested: {
     *     bar: {
     *       baz: 43
     *     }
     *   }
     * });
     * store.setRemoteUser(remoteUser).then(function() {
     *   store.getByRemoteData({
     *     "toplevel": "foo",
     *     "nested.bar.baz": 43
     *   })
     * });
     */
    public getByRemoteData(dataQuery: Record<string, unknown>) {
        if (typeof dataQuery !== "object") {
            throw new Error("Data query must be an object.");
        }
        const query: Record<string, unknown> = {};
        Object.keys(dataQuery).forEach((key: string) => {
            query["data." + key] = dataQuery[key];
        });
        query.type = "remote";

        return this.select(query, this.convertTo((doc: {id: string, data: Record<string, unknown>}) =>
            new RemoteUser(doc.id, doc.data)
        ));
    }

    /**
     * Get Matrix users by some data about them, previously stored via the set
     * method on the Matrix user.
     * @param dataQuery The keys and matching values the remote users share.
     * This should use dot notation for nested types. For example:
     * <code> { "topLevel.midLevel.leaf": 42, "otherTopLevel": "foo" } </code>
     * @return Resolves to a possibly empty list of
     * MatrixUsers. Rejects with an error if there was a problem querying the store.
     * @throws If dataQuery isn't an object.
     * @example
     * matrixUser.set({
     *   toplevel: "foo",
     *   nested: {
     *     bar: {
     *       baz: 43
     *     }
     *   }
     * });
     * store.setMatrixUser(matrixUser).then(function() {
     *   store.getByMatrixData({
     *     "toplevel": "foo",
     *     "nested.bar.baz": 43
     *   })
     * });
     */
    public getByMatrixData(dataQuery: Record<string, unknown>) {
        if (typeof dataQuery !== "object") {
            throw new Error("Data query must be an object.");
        }
        const query: Record<string, unknown> = {};
        Object.keys(dataQuery).forEach((key: string) => {
            query["data." + key] = dataQuery[key];
        });
        query.type = "matrix";

        return this.select(query, this.convertTo((doc: {id: string, data: Record<string, unknown>}) =>
            new MatrixUser(doc.id, doc.data)
        ));
    }

    /**
     * Store a Remote user. If they already exist, they will be updated. Equivalence
     * is determined by the Remote ID.
     * @param remoteUser The remote user
     */
    public setRemoteUser(remoteUser: RemoteUser) {
        return this.upsert({
            type: "remote",
            id: remoteUser.getId()
        }, {
            type: "remote",
            id: remoteUser.getId(),
            data: remoteUser.serialize()
        });
    }

    /**
     * Create a link between a matrix and remote user. If either user does not exist,
     * they will be inserted prior to linking. This is done to ensure foreign key
     * constraints are satisfied (so you cannot have a mapping to a user ID which
     * does not exist).
     * @param matrixUser The matrix user
     * @param remoteUser The remote user
     */
    public async linkUsers(matrixUser: MatrixUser, remoteUser: RemoteUser) {
        await this.insertIfNotExists({
            type: "remote",
            id: remoteUser.getId()
        }, {
            type: "remote",
            id: remoteUser.getId(),
            data: remoteUser.serialize()
        });
        await this.insertIfNotExists({
            type: "matrix",
            id: matrixUser.getId()
        }, {
            type: "matrix",
            id: matrixUser.getId(),
            data: matrixUser.serialize()
        });
        return this.upsert({
            type: "union",
            remote_id: remoteUser.getId(),
            matrix_id: matrixUser.getId()
        }, {
            type: "union",
            remote_id: remoteUser.getId(),
            matrix_id: matrixUser.getId()
        });
    }

    /**
     * Delete a link between a matrix user and a remote user.
     * @param matrixUser The matrix user
     * @param remoteUser The remote user
     * @return Resolves to the number of entries removed.
     */
    public unlinkUsers(matrixUser: MatrixUser, remoteUser: RemoteUser) {
        return this.unlinkUserIds(matrixUser.getId(), remoteUser.getId());
    }

    /**
     * Delete a link between a matrix user ID and a remote user ID.
     * @param matrixUserId The matrix user ID
     * @param remoteUserId The remote user ID
     * @return Resolves to the number of entries removed.
     */
    public unlinkUserIds(matrixUserId: string, remoteUserId: string) {
        return this.delete({
            type: "union",
            remote_id: remoteUserId,
            matrix_id: matrixUserId
        });
    }

    /**
     * Retrieve a list of matrix user IDs linked to this remote ID.
     * @param remoteId The remote ID
     * @return A list of user IDs.
     */
    public getMatrixLinks(remoteId: string): Promise<string[]|null> {
        return this.select({
            type: "union",
            remote_id: remoteId
            // eslint-disable-next-line camelcase
        }, this.convertTo((doc: {matrix_id: string}) =>
            doc.matrix_id
        ));
    }

    /**
     * Retrieve a list of remote IDs linked to this matrix user ID.
     * @param matrixId The matrix user ID
     * @return A list of remote IDs.
     */
    public getRemoteLinks(matrixId: string): Promise<string[]|null> {
        return this.select({
            type: "union",
            matrix_id: matrixId
            // eslint-disable-next-line camelcase
        }, this.convertTo((doc: {remote_id: string}) =>
            doc.remote_id
        ));
    }
}
