import { webcrypto } from 'node:crypto';
import { Request, Response, default as express, Application, NextFunction, Router } from 'express';
import { ApiError, IApiError, Logger, ErrCode } from '..';
import { Server, get } from 'http';
import { MatrixClient } from 'matrix-bot-sdk';
const subtleCrypto = webcrypto.subtle;
const log = new Logger('MediaProxy');

interface MediaMetadata {
    endDt?: number;
    eventId: string;
    id: string;
    roomId: string;
}

interface Opts {
    publicUrl: URL;
    ttl?: number;
    signingKey: webcrypto.CryptoKey;
    signingAlgorithm: webcrypto.AlgorithmIdentifier;
}

/**
 * https://github.com/matrix-org/matrix-spec-proposals/blob/rav/propsal/content_tokens_for_media/proposals/3910-content-tokens-for-media.md
 */
interface MSC3910Content {
    content_token?: string;
    url?: string;
}

/**
 * A media proxy class intended for bridges which share media to the
 * public internet.
 */

export class MediaProxy {
    private readonly internalRouter: Router;

    /**
     * Only used if start() is called.
     */
    private readonly app?: Application;
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
        // TODO "/v1/media/thumbnail/xyz"
        this.internalRouter.get('/v1/media/download/:mediaToken',
            (req, res, next) => this.onMediaRequest(req, res).catch(ex => next(ex))
        );
        this.internalRouter.use(this.onError);
    }

    public async start(port: number, hostname = "0.0.0.0", backlog = 10): Promise<void> {
        const app = express();
        app.use(this.internalRouter);
        return new Promise<void>((res) => {
            if (this.app) {
                this.server = this.app.listen(port, hostname, backlog, () => res());
                log.info(`Media proxy API listening on port ${port}`);
            }
        });
    }

    public close(): Promise<void> {
        return new Promise((res, rej) => this.server?.close(e => e ? rej(e) : res()));
    }

    async getMediaToken(metadata: MediaMetadata) {
        const data = Buffer.from(JSON.stringify(metadata));
        const sig = Buffer.from(
            await subtleCrypto.sign(this.opts.signingAlgorithm, this.opts.signingKey, data)
        ).toString('base64');
        return Buffer.from(JSON.stringify({...metadata, signature: sig})).toString('base64url');
    }

    async verifyMediaToken(token: string ): Promise<MediaMetadata> {
        let data: MediaMetadata&{signature: string};
        try {
            data = JSON.parse(Buffer.from(token, 'base64url').toString('utf-8'));
        }
        catch (ex) {
            throw new ApiError("Media token is invalid", ErrCode.BadValue);
        }
        const signature = Buffer.from(data.signature, 'base64');
        if (!signature) {
            throw new ApiError("Signature missing from metadata", ErrCode.BadValue);
        }
        const signedJson = {...data, signature: undefined};
        const signedData = Buffer.from(JSON.stringify(signedJson));
        try {
            if (!subtleCrypto.verify(this.opts.signingAlgorithm, this.opts.signingKey, signedData, signature)) {
                throw new Error('Signature did not match');
            }
        }
        catch (ex) {
            throw new ApiError('Media token signature is invalid', ErrCode.BadValue)
        }
        return signedJson;
    }


    public async generateMediaUrl(roomId: string, eventId: string, id: string): Promise<URL> {
        const endDt = this.opts.ttl ? Date.now() + this.opts.ttl : undefined;
        const token = await this.getMediaToken({ endDt, eventId, id, roomId });
        const slash = this.opts.publicUrl.pathname.endsWith('/') ? '' : '/';
        const path = new URL(
            `${this.opts.publicUrl.pathname}${slash}/v1/media/download/${token}`,
            this.opts.publicUrl.origin
        );
        return path;
    }

    private extractParametersFromEvent(event: MSC3910Content): {url: string, contentToken?: string} {
        // TODO: Support more kinds of media.
        if (!event.url) {
            throw new ApiError('No `url` in event, cannot find media', ErrCode.NotFound);
        }
        const url = this.matrixClient.mxcToHttp(event.url);
        return {
            url,
            contentToken: event.content_token,
        }
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
        let event;
        try {
            event = await this.matrixClient.getEvent(metadata.roomId, metadata.eventId);
        }
        catch (ex) {
            throw new ApiError('Media could not be found. It may no longer exist', ErrCode.NotFound);
        }
        // Cache from this point onwards.
        // Extract the media from the event.
        const {url, contentToken} = this.extractParametersFromEvent(event);
        get(url, {
            headers: {
                'Authorization': `Bearer ${this.matrixClient.accessToken}`,
                ...( contentToken && { 'X-Matrix-Content-Token': contentToken }),
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
