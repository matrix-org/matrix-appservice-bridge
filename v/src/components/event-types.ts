/* eslint-disable camelcase */
export interface WeakEvent extends Record<string, unknown> {
    event_id: string;
    room_id: string;
    sender: string;
    content: Record<string, unknown>;
    unsigned?: {
        age?: number;
    }
    origin_server_ts: number;
    state_key?: string;
    type: string;
}

export interface TypingEvent {
    type: "m.typing";
    content: {
        // eslint-disable-next-line camelcase
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

export interface WeakStateEvent extends WeakEvent {
    state_key: string;
}

export type EphemeralEvent = TypingEvent|ReadReceiptEvent|PresenceEvent;
