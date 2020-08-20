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

export class RemoteUser {

    /**
     * @param identifier The unique ID for this user.
     * @param data The serialized key-value data object to assign to this user.
     * @throws If identifier is not supplied.
     */
    constructor (public readonly id: string, public readonly data: Record<string, unknown>) {
        if (!id) {
            throw new Error("Missing identifier");
        }
        this.data = data || {};
    }

    /**
     * Get the Remote user ID.
     * @return The id
     */
    public getId() {
        return this.id;
    }

    /**
     * Serialize all the data about this room, excluding the room ID.
     * @return The serialised data
     */
    public serialize() {
        return this.data;
    }

    /**
     * Get the data value for the given key.
     * @param key An arbitrary bridge-specific key.
     * @return Stored data for this key. May be undefined.
     */
    public get<T>(key: string) {
        return this.data[key] as T;
    }

    /**
     * Set an arbitrary bridge-specific data value for this room.
     * @param key The key to store the data value under.
     * @param val The data value. This value should be serializable via
     * <code>JSON.stringify(data)</code>.
     */
    public set(key: string, val: unknown) {
        this.data[key] = val;
    }
}