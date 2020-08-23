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

import { MatrixUser } from "../models/users/matrix";
import { MatrixRoom } from "../models/rooms/matrix";
import { RoomBridgeStore } from "./room-bridge-store";
import { UserBridgeStore } from "./user-bridge-store";
import { RemoteUser } from "../models/users/remote";
import { RemoteRoom } from "../models/rooms/remote";
import { wrap } from "../errors";

interface BridgeContextSenders {
    matrix: MatrixUser;
    remote: RemoteUser|null;
    remotes: RemoteUser[];
}

interface BridgeContextTargets {
    matrix: MatrixUser|null;
    remote: RemoteUser|null;
    remotes: RemoteUser[];
}

interface BridgeContextRoom {
    matrix: MatrixRoom;
    remote: RemoteRoom|null;
    remotes: RemoteRoom[];
}

export class BridgeContext {
    public readonly senders: BridgeContextSenders;
    public readonly targets: BridgeContextTargets;
    public readonly rooms: BridgeContextRoom;
    /**
     * @param ctx Event related data
     * @param ctx.sender Matrix user ID of the sender.
     * @param ctx.target Matrix user ID of the target.
     * @param ctx.room Matrix room ID.
     */
    constructor(private ctx: { sender: string, target: string|undefined, room: string}) {
        this.senders = {
            matrix: new MatrixUser(this.ctx.sender),
            remote: null,
            remotes: [],
        };
        this.targets = {
            matrix: this.ctx.target ? new MatrixUser(this.ctx.target) : null,
            remote: null,
            remotes: [],
        };
        this.rooms = {
            matrix: new MatrixRoom(this.ctx.room),
            remote: null,
            remotes: [],
        };
    }

    /**
     * Returns this instance after its initialization.
     *
     * @param {RoomBridgeStore} roomStore
     * @param {UserBridgeStore} userStore
     * @returns {Promise<BridgeContext>}
     */
    async get(roomStore: RoomBridgeStore, userStore: UserBridgeStore) {
        try {
            const results = await Promise.all([
                roomStore.getLinkedRemoteRooms(this.ctx.room),
                userStore.getRemoteUsersFromMatrixId(this.ctx.sender),
                (this.ctx.target ?
                    userStore.getRemoteUsersFromMatrixId(this.ctx.target) :
                    Promise.resolve([])
                ),
                roomStore.getMatrixRoom(this.ctx.room),
                userStore.getMatrixUser(this.ctx.sender),
            ]);
            const [remoteRooms, remoteSenders, remoteTargets, mxRoom, mxSender] = results;
            if (remoteRooms.length) {
                this.rooms.remotes = remoteRooms;
                this.rooms.remote = remoteRooms[0];
            }
            if (remoteSenders.length) {
                this.senders.remotes = remoteSenders;
                this.senders.remote = remoteSenders[0];
            }
            if (remoteTargets.length) {
                this.targets.remotes = remoteTargets;
                this.targets.remote = remoteTargets[0];
            }
            if (mxRoom) {
                this.rooms.matrix = mxRoom;
            }
            if (mxSender) {
                this.senders.matrix = mxSender;
            }
        }
        catch (ex) {
            throw wrap(ex, Error, "Could not retrieve bridge context");
        }
        return this;
    }
}
