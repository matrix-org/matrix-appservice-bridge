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
 * Create a matrix room.
 * @constructor
 * @param roomId The room ID
 */
export class MatrixRoom {
    public name?: string;
    public topic?: string;
    private _extras: Record<string, unknown> = {};
    constructor(public readonly roomId: string, data?: {name: string, topic: string, extras: Record<string, unknown>}) {
        if (data) {
            this.deserialize(data);
        }
    }

    /**
     * Get the room ID.
     * @return The room ID
     */
    public getId() {
        return this.roomId;
    };

    /**
     * Get the data value for the given key.
     * @param key An arbitrary bridge-specific key.
     * @return Stored data for this key. May be undefined.
     */
    public get<T>(key: string) {
        return this._extras[key] as T;
    };

    /**
     * Set an arbitrary bridge-specific data value for this room. This will be serailized
     * under an 'extras' key.
     * @param key The key to store the data value under.
     * @param val The data value. This value should be serializable via
     * <code>JSON.stringify(data)</code>.
     */
    public set<T>(key: string, val: T) {
        this._extras[key] = val;
    };

    /**
     * Serialize data about this room into a JSON object.
     * @return The serialised data
     */
    public serialize() {
        return {
            name: this.name,
            topic: this.topic,
            extras: this._extras
        };
    };

    /**
     * Set data about this room from a serialized data object.
     * @param data The serialized data
     */
    public deserialize(data: {name: string, topic: string, extras: Record<string, unknown>}) {
        this.name = data.name;
        this.topic = data.topic;
        this._extras = data.extras;
    }
}