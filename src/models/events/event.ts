/*
Copyright 2019 The Matrix.org Foundation C.I.C.

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

export interface StoredEventDoc {
    id: string;
    matrix: {
        roomId: string,
        eventId: string
    };
    remote: {
        roomId: string,
        eventId: string
    };
    extras: Record<string, unknown>;
}

export class StoredEvent {
    /**
     * Create a store event.
     * @param roomId The matrix room ID
     * @param eventId The matrix event ID
     * @param remoteRoomId The remote room ID
     * @param remoteEventId The remote event ID
     * @param _extras Any extra data that may be included with the event.
     */
    constructor(public roomId: string,
        public eventId: string, public remoteRoomId: string,
        public remoteEventId: string,
        private readonly _extras: Record<string, unknown> = {}
    ) { }

    /**
     * Get the unique ID.
     * @return A unique ID
     */
    public getId() {
        return this.eventId + this.remoteEventId;
    }

    /**
     * Get the matrix room ID.
     * @return The room ID
     */
    public getMatrixRoomId() {
        return this.roomId;
    }

    /**
     * Get the matrix event ID.
     * @return The event ID
     */
    public getMatrixEventId() {
        return this.eventId;
    }

    /**
     * Get the remote room ID.
     * @return The remote room ID
     */
    public getRemoteRoomId() {
        return this.remoteRoomId;
    }

    /**
     * Get the remote event ID.
     * @return The remote event ID
     */
    public getRemoteEventId() {
        return this.remoteEventId;
    }

    /**
     * Get the data value for the given key.
     * @param key An arbitrary bridge-specific key.
     * @return Stored data for this key. May be undefined.
     */
    public get<T>(key: string) {
        return this._extras[key] as T;
    }

    /**
     * Set an arbitrary bridge-specific data value for this event. This will be serailized
     * under an 'extras' key.
     * @param key The key to store the data value under.
     * @param val The data value. This value should be serializable via
     * <code>JSON.stringify(data)</code>.
     */
    public set(key: string, val: unknown) {
        this._extras[key] = val;
    }

    /**
     * Serialize data about this event into a JSON object.
     */
    public serialize(): StoredEventDoc {
        return {
            id: this.getId(),
            matrix: {
                roomId: this.roomId,
                eventId: this.eventId,
            },
            remote: {
                roomId: this.remoteRoomId,
                eventId: this.remoteEventId,
            },
            extras: this._extras,
        };
    }

    /**
     * Set data about this event from a serialized data object.
     * @param data The serialized data
     */
    public static deserialize(data: StoredEventDoc) {
        return new StoredEvent(
            data.matrix.roomId,
            data.matrix.eventId,
            data.remote.roomId,
            data.remote.eventId,
            data.extras
        );
    }
}
