import { webcrypto } from 'node:crypto';
import { Request, Response, default as express, Application, NextFunction, Router } from 'express';
import { ApiError, IApiError, Logger, ErrCode } from '..';
import { Server, get } from 'http';
import { MatrixClient } from '@vector-im/matrix-bot-sdk';
const subtleCrypto = webcrypto.subtle;
const log = new Logger('MediaProxy');

interface MediaMetadata {
    endDt?: number;
    mxc: string;
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
        // V1 token format:
        // - At offset zero: a single byte, numeric int, indicating a token version.
        //   Version 0 is reserved for future use, for the remote possibility we run out of versions in an int8 :)
        // - At offset 1: the SHA-512 HMAC signature of the payload (64 bytes)
        // - At offset 65: MediaMetadata.endDt, encoded as a Big-Endian double (matching JS' `number` type).
        //   An undefined endDt is encoded as a -1. 8 bytes.
        // - At offset 73: the MXC of the media content, until the end of the buffer.
        // The payload, for the purpose of generating the signature,
        // is the byte-encoded endDt concatenated with the byte-encoded MXC.
        const version = Buffer.allocUnsafe(1);
        version.writeInt8(1);

        const dt = Buffer.allocUnsafe(8);
        dt.writeDoubleBE(metadata.endDt ?? -1);

        const mxcBuf = Buffer.from(metadata.mxc);

        const payload = Buffer.concat([dt, mxcBuf]);
        const sig = Buffer.from(await subtleCrypto.sign(ALGORITHM, this.opts.signingKey, payload));

        const token = Buffer.concat([version, sig, dt, mxcBuf]);
        return token.toString('base64url');
    }

    async verifyMediaToken(token: string): Promise<MediaMetadata> {
        const buf = Buffer.from(token, 'base64url');
        let cursor = 0;
        const version = buf.readInt8(cursor++);
        if (version !== 1) {
            throw new ApiError(`Unrecognized version of media token (${version})`, ErrCode.BadValue);
        }

        const sig = buf.subarray(cursor, cursor += 64);
        const dtBuf = buf.subarray(cursor, cursor += 8);
        const mxcBuf = buf.subarray(cursor);

        try {
            if (!subtleCrypto.verify(ALGORITHM, this.opts.signingKey, Buffer.concat([dtBuf, mxcBuf]), sig)) {
                throw new Error('Signature did not match');
            }
        }
        catch (ex) {
            throw new ApiError('Media token signature is invalid', ErrCode.BadValue)
        }

        const dt = dtBuf.readDoubleBE();
        return {
            mxc: mxcBuf.toString(),
            endDt: dt === -1 ? undefined : dt,
        };
    }


    public async generateMediaUrl(mxc: string): Promise<URL> {
        const endDt = this.opts.ttl ? Date.now() + this.opts.ttl : undefined;
        // Remove cruft
        const token = await this.getMediaToken({ endDt, mxc: mxc.replace('mxc://', '') });
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
        // Cache from this point onwards.
        // Extract the media from the event.
        const url = this.matrixClient.mxcToHttp('mxc://' + metadata.mxc);
        get(url, {
            headers: {
                'Authorization': `Bearer ${this.matrixClient.accessToken}`,
            },
        }, (getRes) => {
            const { statusCode } = res;
            res.setHeader('content-disposition', getRes.headers['content-disposition'] as string);
            res.setHeader('content-type', getRes.headers['content-type'] as string);
            res.setHeader('content-length', getRes.headers['content-length'] as string);
            res.status(statusCode);
            getRes.pipe(res);
        });
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
