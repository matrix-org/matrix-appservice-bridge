export interface WeakEvent extends Record<string, unknown> {
    event_id: string; // eslint-disable-line camelcase
    room_id: string; // eslint-disable-line camelcase
    sender: string;
    content: Record<string, unknown>;
    unsigned: {
        age: number;
    }
    origin_server_ts: number; // eslint-disable-line camelcase
    state_key: string; // eslint-disable-line camelcase
    type: string;
}

export interface TypingEvent {
    type: "m.typing";
    content: {
        user_ids: string[];
    }
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
    room_id: string;
}

export interface PresenceEvent {
    content: {
        avatar_url?: string;
        currently_active?: boolean;
        last_active_ago?: number;
        presence: "online"|"offline"|"unavailable";
        status_msg?: string;
    },
    sender: string;
    type: "m.presence";
}

export type EphemeralEvent = TypingEvent|ReadReceiptEvent|PresenceEvent;