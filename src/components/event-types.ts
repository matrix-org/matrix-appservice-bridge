export interface WeakEvent extends Record<string, unknown> {
    // eslint-disable-next-line camelcase
    event_id: string;
    // eslint-disable-next-line camelcase
    room_id: string;
    sender: string;
    content: Record<string, unknown>;
    unsigned: {
        age: number;
    }
    // eslint-disable-next-line camelcase
    origin_server_ts: number;
    // eslint-disable-next-line camelcase
    state_key: string;
    type: string;
}

export interface TypingEvent {
    type: "m.typing";
    content: {
        // eslint-disable-next-line camelcase
        user_ids: string[];
    }
    // eslint-disable-next-line camelcase
    room_id: string;
}

export interface ReadReceiptEvent {
    content: {
        [eventId: string]: {
            "m.read": {
                [userId: string]: {
                    ts: number
                }
            }
        }
    }
    type: "m.receipt";
    // eslint-disable-next-line camelcase
    room_id: string;
}

export interface PresenceEvent {
    content: {
        // eslint-disable-next-line camelcase
        avatar_url?: string;
        // eslint-disable-next-line camelcase
        currently_active?: boolean;
        // eslint-disable-next-line camelcase
        last_active_ago?: number;
        presence: "online"|"offline"|"unavailable";
        // eslint-disable-next-line camelcase
        status_msg?: string;
    },
    sender: string;
    type: "m.presence";
}

export type EphemeralEvent = TypingEvent|ReadReceiptEvent|PresenceEvent;
