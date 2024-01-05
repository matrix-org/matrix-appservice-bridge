/* eslint-disable @typescript-eslint/no-explicit-any */
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

import Datastore from "nedb";
import { BridgeStore } from "./bridge-store";
import { StoredEvent, StoredEventDoc } from "../models/events/event";

/**
 * Construct a store suitable for event mapping information. Data is stored
 * as {@link StoredEvent}s.
 * @constructor
 * @param db The connected NEDB database instance
 */
export class EventBridgeStore extends BridgeStore {
    constructor(db: Datastore) { super(db) }

    /**
     * Insert an event, clobbering based on the ID of the StoredEvent.
     * @param event
     */
    public upsertEvent(event: StoredEvent) {
        return this.upsert({
            id: event.getId()
        }, event.serialize());
    }

    /**
     * Get an existing event based on the provided matrix IDs.
     * @param roomId The ID of the room.
     * @param eventId The ID of the event.
     * @return A promise which resolves to the StoredEvent or null.
     */
    public getEntryByMatrixId(roomId: string, eventId: string): Promise<StoredEvent|null> {
        return this.selectOne<any, StoredEvent>({
            "matrix.roomId": roomId,
            "matrix.eventId": eventId,
        }, (this.convertTo(function(doc: StoredEventDoc) {
            return StoredEvent.deserialize(doc);
        })));
    }

    /**
     * Get an existing event based on the provided remote IDs.
     * @param roomId The ID of the room.
     * @param eventId The ID of the event.
     * @return A promise which resolves to the StoredEvent or null.
     */
    public getEntryByRemoteId(roomId: string, eventId: string) {
        return this.selectOne({
            "remote.roomId": roomId,
            "remote.eventId": eventId,
        }, this.convertTo((doc: StoredEventDoc) => {
            return StoredEvent.deserialize(doc);
        }));
    }

    /**
     * Remove entries based on the event data.
     * @param event The event to remove.
     */
    public removeEvent(event: StoredEvent) {
        return this.delete({
            id: event.getId(),
        });
    }

    /**
     * Remove entries based on the matrix IDs.
     * @param roomId The ID of the room.
     * @param eventId The ID of the event.
     */
    public removeEventByMatrixId(roomId: string, eventId: string) {
        return this.delete({
            "matrix.roomId": roomId,
            "matrix.eventId": eventId,
        });
    }

    /**
     * Remove entries based on the matrix IDs.
     * @param roomId The ID of the room.
     * @param eventId The ID of the event.
     */
    public removeEventByRemoteId(roomId: string, eventId: string) {
        return this.delete({
            "remote.roomId": roomId,
            "remote.eventId": eventId,
        });
    }
}
