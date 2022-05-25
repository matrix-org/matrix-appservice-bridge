import { MatrixClient } from "matrix-bot-sdk";

export enum ServiceNotificationNoticeCode {
	Unknown = "UNKNOWN",
	Blocked = "BLOCKED",
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
	/**
	 * The roomId to send notices to.
	 */
	roomId: string;
	/**
	 * The minimum time allowed before
	 * a new notice with the same ID can be sent (to avoid room spam).
	 * Defaults to a hour.
	 */
	minimumUpdatePeriodMs?: number;
	/**
	 * The prefix to use in state keys to uniquely namespace the bridge.
	 */
	bridgeStateKeyPrefix: string;
	/**
	 * Any metadata to be included in all notice events.
	 */
	metadata: Record<string, unknown>
}

export interface NotificationEventContent {
	message: string;
	code: ServiceNotificationNoticeCode|string,
	// eslint-disable-next-line camelcase
	notice_id: string,
	metadata: Record<string, unknown>;
	severity: ServiceNotificationServerity;
	"org.matrix.msc1767.text": string,
}

interface ResolvedEventContent {
	resolved: boolean;
}

const STATE_KEY_TYPE = "org.matrix.service-notice";
const DEFAULT_UPDATE_TIME_MS = 1000 * 60 * 60;

/**
 * The service room component allows bridges to report service issues to an upstream service or user.
 */
export class ServiceRoom {

	/**
	 * The last time a given noticeId was sent. This is reset when the notice is resolved.
	 */
	private readonly lastNoticeTime = new Map<string, number>();

	/**
	 * A set of noticeIDs which we know are already resolved (and therefore can skip requests to the homeserver)
	 */
	private readonly resolvedNotices = new Set<string>();
	constructor(private readonly opts: ServiceRoomOpts, private readonly client: MatrixClient) { }

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
		code: ServiceNotificationNoticeCode|string = ServiceNotificationNoticeCode.Unknown): Promise<void> {
		if (Date.now() - (this.lastNoticeTime.get(noticeId) ?? 0) <=
			(this.opts.minimumUpdatePeriodMs ?? DEFAULT_UPDATE_TIME_MS)) {
			return;
		}
		const content: NotificationEventContent = {
			message,
			severity,
			notice_id: noticeId,
			metadata: this.opts.metadata,
			code,
			"org.matrix.msc1767.text": `Notice (severity: ${severity}): ${message}`
		};
		this.resolvedNotices.delete(noticeId);
		await this.client.sendStateEvent(
			this.opts.roomId,
			STATE_KEY_TYPE,
			this.getStateKey(noticeId),
			content
		);
		this.lastNoticeTime.set(noticeId, Date.now());
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
			{
				resolved: true,
				metadata: this.opts.metadata
			}
		);
		this.lastNoticeTime.delete(noticeId);
		this.resolvedNotices.add(noticeId);
		return true;
	}
}
