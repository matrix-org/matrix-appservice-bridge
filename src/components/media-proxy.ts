import { webcrypto } from 'node:crypto';
import { Request, Response, default as express, NextFunction, Router } from 'express';
import { ApiError, IApiError, Logger, ErrCode } from '..';
import { Server, get as httpGet } from 'http';
import { get as httpsGet } from "https";
import { MatrixClient } from '@vector-im/matrix-bot-sdk';
const subtleCrypto = webcrypto.subtle;
const log = new Logger('MediaProxy');

interface MediaMetadata {
    endDt?: number;
    mxc: string;
    /**
     * The room the media was sent in, if known. Used to check that the
     * source event has not since been redacted before proxying the media.
     */
    roomId?: string;
    /**
     * The event the media was sent in, if known. Used to check that the
     * source event has not since been redacted before proxying the media.
     */
    eventId?: string;
}

interface Opts {
    publicUrl: URL;
    ttl?: number;
    signingKey: webcrypto.CryptoKey;
}

const ALGORITHM: webcrypto.HmacKeyAlgorithm = { name: 'hmac', hash: {
        name: 'SHA-512'
    },
    length: 512,
};

/**
 * A media proxy class intended for bridges which share media to the
 * public internet.
 */

export class MediaProxy {
    private readonly internalRouter: Router;

    /**
     * Only used if start() is called.
     */
    private server?: Server;
    /**
     * Get the express router used for handling calls.
     */
    public get router() {
        return this.internalRouter;
    }

    constructor(private readonly opts: Opts, private readonly matrixClient: MatrixClient) {
        // eslint-disable-next-line new-cap
        this.internalRouter = Router();
        this.internalRouter.use((req, _res, next) => {
            log.info(`${req.method} ${req.path} ${req.ip || ''} ${req.headers["user-agent"] || ''}`);
            next();
        });
        this.internalRouter.get('/health', this.getHealth.bind(this));
        this.internalRouter.get('/v1/media/download/:mediaToken',
            (req, res, next) => this.onMediaRequest(req, res).catch(ex => next(ex))
        );
        this.internalRouter.use(this.onError);
    }

    public async start(port: number, hostname = "0.0.0.0", backlog = 10): Promise<void> {
        const app = express();
        app.use(this.internalRouter);
        return new Promise<void>((res) => {
            this.server = app.listen(port, hostname, backlog, () => res());
            log.info(`Media proxy API listening on port ${port}`);
        });
    }

    public close(): Promise<void> {
        return new Promise((res, rej) => this.server?.close(e => e ? rej(e) : res()));
    }

    async getMediaToken(metadata: MediaMetadata) {
        // V2 token format:
        // - At offset zero: a single byte, numeric int, indicating a token version.
        //   Version 0 is reserved for future use, for the remote possibility we run out of versions in an int8 :)
        // - At offset 1: the SHA-512 HMAC signature of the payload (64 bytes)
        // - At offset 65: MediaMetadata.endDt, encoded as a Big-Endian double (matching JS' `number` type).
        //   An undefined endDt is encoded as a -1. 8 bytes.
        // - At offset 73: the room ID the media was sent in (may be empty), NUL terminated.
        // - Following that: the event ID the media was sent in (may be empty), NUL terminated.
        // - Following that: the MXC of the media content, until the end of the buffer.
        // The payload, for the purpose of generating the signature,
        // is the byte-encoded endDt concatenated with the byte-encoded roomId, eventId and MXC.
        const version = Buffer.allocUnsafe(1);
        version.writeInt8(2);

        const dt = Buffer.allocUnsafe(8);
        dt.writeDoubleBE(metadata.endDt ?? -1);

        const nul = Buffer.from([0]);
        const roomIdBuf = Buffer.from(metadata.roomId ?? '');
        const eventIdBuf = Buffer.from(metadata.eventId ?? '');
        const mxcBuf = Buffer.from(metadata.mxc);

        const payload = Buffer.concat([dt, roomIdBuf, nul, eventIdBuf, nul, mxcBuf]);
        const sig = Buffer.from(await subtleCrypto.sign(ALGORITHM, this.opts.signingKey, payload));

        const token = Buffer.concat([version, sig, payload]);
        return token.toString('base64url');
    }

    async verifyMediaToken(token: string): Promise<MediaMetadata> {
        const buf = Buffer.from(token, 'base64url');
        let cursor = 0;
        const version = buf.readInt8(cursor++);
        if (version !== 1 && version !== 2) {
            throw new ApiError(`Unrecognized version of media token (${version})`, ErrCode.BadValue);
        }

        const sig = buf.subarray(cursor, cursor += 64);
        const dtBuf = buf.subarray(cursor, cursor += 8);
        const payload = buf.subarray(cursor);

        try {
            if (!subtleCrypto.verify(ALGORITHM, this.opts.signingKey, Buffer.concat([dtBuf, payload]), sig)) {
                throw new Error('Signature did not match');
            }
        }
        catch {
            throw new ApiError('Media token signature is invalid', ErrCode.BadValue)
        }

        const dt = dtBuf.readDoubleBE();
        const endDt = dt === -1 ? undefined : dt;

        // Older tokens (v1) only ever encoded the MXC URI, with no way to tie
        // the media back to the event it was sent from.
        if (version === 1) {
            return {
                mxc: payload.toString(),
                endDt,
            };
        }

        const firstNul = payload.indexOf(0);
        const secondNul = payload.indexOf(0, firstNul + 1);
        const roomId = payload.subarray(0, firstNul).toString() || undefined;
        const eventId = payload.subarray(firstNul + 1, secondNul).toString() || undefined;
        const mxc = payload.subarray(secondNul + 1).toString();

        return {
            mxc,
            endDt,
            roomId,
            eventId,
        };
    }


    /**
     * Generate a public URL for some media.
     * @param mxc The mxc:// URI of the media to be proxied.
     * @param sourceEvent The room and event the media was sent in, if known.
     *                     When provided, the proxy will refuse to serve the
     *                     media once the source event has been redacted.
     */
    public async generateMediaUrl(
        mxc: string, sourceEvent?: { roomId: string, eventId: string }
    ): Promise<URL> {
        const endDt = this.opts.ttl ? Date.now() + this.opts.ttl : undefined;
        // Remove cruft
        const token = await this.getMediaToken({
            endDt,
            mxc: mxc.replace('mxc://', ''),
            roomId: sourceEvent?.roomId,
            eventId: sourceEvent?.eventId,
        });
        const { pathname, origin } = this.opts.publicUrl;
        const slash = pathname.endsWith('/') ? '' : '/';
        const path = new URL(
            `${pathname}${slash}v1/media/download/${token}`,
            origin
        );
        return path;
    }

    public async onMediaRequest(req: Request, res: Response) {
        const { mediaToken } = req.params;
        if (typeof mediaToken !== "string") {
            throw new ApiError("Invalid mediaToken supplied", ErrCode.BadValue);
        }
        const metadata = await this.verifyMediaToken(mediaToken);
        if (metadata.endDt && metadata.endDt < Date.now()) {
            throw new ApiError('Access to the media you requested has now expired.', ErrCode.NotFound);
        }
        if (metadata.roomId && metadata.eventId) {
            await this.checkEventNotRedacted(metadata.roomId, metadata.eventId);
        }
        // Cache from this point onwards.
        // Extract the media from the event.
        const mxcMatch = metadata.mxc.match(new RegExp('^([^/]+)/(.+)$'));
        if (!mxcMatch) {
            throw new ApiError('Invalid MXC URI', ErrCode.BadValue);
        }
        const [, serverName, mediaId] = mxcMatch;
        const url = `${this.matrixClient.homeserverUrl}/_matrix/client/v1/media/download/${serverName}/${mediaId}`;
        const get = url.startsWith("https:") ? httpsGet : httpGet;
        return new Promise<void>((resolve, reject) => {
            get(url, {
                headers: {
                    'Authorization': `Bearer ${this.matrixClient.accessToken}`,
                },
            }, (getRes) => {
                try {
                    const { statusCode } = res;
                    if (getRes.headers['content-disposition']) {
                        res.setHeader('content-disposition', getRes.headers['content-disposition']);
                    }
                    if (getRes.headers['content-type']) {
                        res.setHeader('content-type', getRes.headers['content-type']);
                    }
                    if (getRes.headers['content-length']) {
                        res.setHeader('content-length', getRes.headers['content-length']);
                    }
                    res.status(statusCode);
                    getRes.pipe(res);
                    resolve();
                }
                catch (err: unknown) {
                    log.error('Failed to handle authenticated media request:', err);
                    reject(new ApiError('Failed to handle authenticated media request', ErrCode.Unknown));
                }
            });
        });
    }

    /**
     * Ensure that the event the media was sent in has not since been redacted
     * (e.g. because it was found to contain abusive or otherwise unwanted
     * content). Throws an ApiError if the media should no longer be served.
     */
    private async checkEventNotRedacted(roomId: string, eventId: string): Promise<void> {
        let event;
        try {
            event = await this.matrixClient.getEvent(roomId, eventId);
        }
        catch (ex) {
            log.warn(`Failed to fetch event ${eventId} in ${roomId} while checking for redaction`, ex);
            throw new ApiError('Could not verify that the media is still available', ErrCode.NotFound);
        }
        if (event.unsigned.redacted_because) {
            throw new ApiError('This media is no longer available', ErrCode.NotFound);
        }
    }

    private getHealth(req: Request, res: Response) {
        res.send({ok: true});
    }

    // Needed so that _next can be defined in order to preserve signature.
    private onError(
        err: IApiError|Error,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        _req: Request, res: Response, _next: NextFunction) {
        if (!err) {
            return;
        }
        log.error(err);
        if (res.headersSent) {
            return;
        }
        if ("apply" in err && typeof err.apply === "function") {
            err.apply(res);
        }
        else {
            new ApiError("An internal error occured").apply(res);
        }
    }
}
