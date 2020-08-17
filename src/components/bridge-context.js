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

const Promise = require("bluebird");
const MatrixUser = require("../models/users/matrix");
const MatrixRoom = require("../models/rooms/matrix").MatrixRoom;
const {wrap} = require("../errors");

/**
 * Bridge context.
 *
 * @property {Object} senders Data models on senders of this event
 * @property {MatrixUser} senders.matrix The sender of this event
 * @property {?RemoteUser} senders.remote The first linked remote sender: remotes[0]
 * @property {RemoteUser[]} senders.remotes The linked remote senders
 * @property {Object} targets Data models on targets (e.g. state_key in
 * m.room.member) of this event.
 * @property {?MatrixUser} targets.matrix The target of this event if applicable.
 * @property {?RemoteUser} targets.remote The first linked remote target: remotes[0]
 * @property {RemoteUser[]} targets.remotes The linked remote targets
 * @property {Object} rooms Data models on rooms concerning this event.
 * @property {MatrixRoom} rooms.matrix The room for this event.
 * @property {?RemoteRoom} rooms.remote The first linked remote room: remotes[0]
 * @property {RemoteRoom[]} rooms.remotes The linked remote rooms for this event
 */
class BridgeContext {
    /**
     * @param {Object} ctx Event related data
     * @param {string} ctx.sender Matrix user ID of the sender.
     * @param {string=} ctx.target Matrix user ID of the target.
     * @param {string} ctx.room Matrix room ID.
     */
    constructor(ctx) {
        this._ctx = ctx;
        this.senders = {
            matrix: new MatrixUser(ctx.sender),
            remote: null,
            remotes: [],
        };
        this.targets = {
            matrix: ctx.target ? new MatrixUser(ctx.target) : null,
            remote: null,
            remotes: [],
        };
        this.rooms = {
            matrix: new MatrixRoom(ctx.room),
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
    async get(roomStore, userStore) {
        return Promise.try(() => {
            return [
                roomStore.getLinkedRemoteRooms(this._ctx.room),
                userStore.getRemoteUsersFromMatrixId(this._ctx.sender),
                (this._ctx.target ?
                    userStore.getRemoteUsersFromMatrixId(this._ctx.target) :
                    Promise.resolve([])
                ),
                roomStore.getMatrixRoom(this._ctx.room),
                userStore.getMatrixUser(this._ctx.sender)
            ];
        }).spread((remoteRooms, remoteSenders, remoteTargets, mxRoom, mxSender) => {
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
        }).catch(e => {throw wrap(e, Error, "Could not retrieve bridge context");})
        .return(this);
    }
}

module.exports = BridgeContext;
