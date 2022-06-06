import { EphemeralEvent, WeakEvent } from "../event-types";
import { Request } from "./request";

/**
 * Incoming event from the homeserver.
 */
export class MatrixRequest<T> extends Request<T> {
    constructor(public readonly event: T) {
        super({data: event}, "MatrixReq")
    }
}

/**
 * A timeline event, such as a room timeline message.
 */
export class TimelineMatrixRequest extends MatrixRequest<WeakEvent> {
	constructor(public readonly event: WeakEvent) {
        super(event)
    }

	public sender(): string {
		return this.event.sender;
	}

	public type(): string {
		return this.event.type;
	}

	public stateKey(): string|undefined {
		return this.event.state_key;
	}

	public roomId(): string {
		return this.event.room_id;
	}

	public content(): Record<string, unknown> {
		return this.event.content;
	}
}

/**
 * Ephemeral event, such as a typing notification.
 */
export class EphemeralMatrixRequest extends MatrixRequest<EphemeralEvent> {
	constructor(public readonly event: EphemeralEvent) {
        super(event)
    }

	public type(): string {
		return this.event.type;
	}
}
