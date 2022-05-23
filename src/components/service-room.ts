import { MatrixClient } from "matrix-bot-sdk";

export enum ServiceNotificationNoticeCode {
	Unknown = "UNKNOWN",
	RemoteServiceOutage = "REMOTE_SERVICE_OUTAGE",
	MatrixServiceOutage = "MATRIX_SERVICE_OUTAGE",
}

export enum ServiceNotificationServerity {
	/**
	 * Just information for the administrator, usually no action required.
	 */
	Infomational = "info",
	/**
	 * Something the administrator should know about, might require an explicit notification.
	 */
	Warning = "warning",
	/**
	 * A serious issue has occured with the bridge, action needed.
	 */
	Error = "error",
	/**
	 * The bridge cannot function, action urgently needed.
	 */
	Critical = "critical"
}

export interface ServiceRoomOpts {
	roomId: string;
	bridgeStateKeyPrefix: string;
	metadata: Record<string, undefined>
}

export interface NotificationEventContent {
	message: string;
	code: ServiceNotificationNoticeCode|string,
	notice_id: string,
	metadata: Record<string, undefined>;
	severity: ServiceNotificationServerity;
	"org.matrix.msc1767.text": string,
}

interface ResolvedEventContent {
	resolved: boolean;
}

const STATE_KEY_TYPE = "org.matrix.service-notice";

/**
 * The service room component allows bridges to report service issues to an upstream service or user.
 */
export class ServiceRoom {
	constructor(private readonly opts: ServiceRoomOpts, private readonly client: MatrixClient) {

	}

	private getStateKey(noticeId: string) {
		return `${this.opts.bridgeStateKeyPrefix}_${noticeId}`;
	}

	/**
	 * Get an existing notice.
	 * @param noticeId The ID of the notice.
	 * @returns The notice content, or null if not found.
	 */
	public async getServiceNotification(noticeId: string): Promise<NotificationEventContent|ResolvedEventContent|null> {
		try {
			return this.client.getRoomStateEvent(
				this.opts.roomId,
				STATE_KEY_TYPE,
				this.getStateKey(noticeId),
			);
		}
		catch (ex) {
            if (ex.body.errcode !== "M_NOT_FOUND") {
                throw ex;
            }
			return null;
		}
	}

	/**
	 * Send a service notice to a room. Any existing notices are automatically squashed.
	 * @param message A human readable message for a user to potentially action.
	 * @param severity The severity of the notice.
	 * @param noticeId A unique ID to describe this notice. Subsequent updates to the notice should use the same string.
	 * @param code A optional machine readable code.
	 */
	public async sendServiceNotice(
		message: string,
		severity: ServiceNotificationServerity,
		noticeId: string,
		code: ServiceNotificationNoticeCode|string = ServiceNotificationNoticeCode.Unknown) {
		const content: NotificationEventContent = {
			message,
			severity,
			notice_id: noticeId,
			metadata: this.opts.metadata,
			code,
			"org.matrix.msc1767.text": `Notice (severity: ${severity}): ${message}`
		};
		await this.client.sendStateEvent(
			this.opts.roomId,
			STATE_KEY_TYPE,
			this.getStateKey(noticeId),
			content
		);
	}

	/**
	 * Resolve a previous notice to say that the specific issue has been resolved.
	 * @param noticeId The noticeId to resolve.
	 * @returns `true` if the notice exists and was resolved,
	 * 			`false` if the notice did not exist or was already resolved.
	 */
	public async clearServiceNotice(noticeId: string): Promise<boolean> {
		const serviceNotice = await this.getServiceNotification(noticeId);
		if (!serviceNotice || 'resolved' in serviceNotice) {
			return false;
		}
		await this.client.sendStateEvent(
			this.opts.roomId,
			STATE_KEY_TYPE,
			this.getStateKey(noticeId),
			{ resolved: true }
		);
		return true;
	}
}
