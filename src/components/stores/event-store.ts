import { StoredEvent } from "../../models/events/event";

export interface EventBridgeStore {
    /**
     * Insert an event, clobbering based on the ID of the StoredEvent.
     * @param event
     */
    upsertEvent(event: StoredEvent): Promise<void>
    /**
     * Get an existing event based on the provided matrix IDs.
     * @param roomId The ID of the room.
     * @param eventId The ID of the event.
     * @return A promise which resolves to the StoredEvent or null.
     */
    getEntryByMatrixId(roomId: string, eventId: string): Promise<StoredEvent|null>

    /**
     * Get an existing event based on the provided remote IDs.
     * @param roomId The ID of the room.
     * @param eventId The ID of the event.
     * @return A promise which resolves to the StoredEvent or null.
     */
    getEntryByRemoteId(roomId: string, eventId: string): Promise<StoredEvent|null>

    /**
     * Remove entries based on the event data.
     * @param event The event to remove.
     */
    removeEvent(event: StoredEvent): Promise<void>

    /**
     * Remove entries based on the matrix IDs.
     * @param roomId The ID of the room.
     * @param eventId The ID of the event.
     */
    removeEventByMatrixId(roomId: string, eventId: string): Promise<void>
    /**
     * Remove entries based on the matrix IDs.
     * @param roomId The ID of the room.
     * @param eventId The ID of the event.
     */
    removeEventByRemoteId(roomId: string, eventId: string): Promise<void>
}