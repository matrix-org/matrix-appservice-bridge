import { Application, default as express, NextFunction, Request, Response, Router, Router as router } from "express";
import { ProvisioningStore } from "./store";
import { Server } from "http";
import { v4 as uuid } from "uuid";
import axios from "axios";
import cors from "cors";
import Logs from "../components/logging";
import ProvisioningRequest from "./request";
import { ApiError } from "./errors";

const log = Logs.get("ProvisioningApi");

interface MatrixServerWellKnown {
    "m.server": string;
}

interface ExpRequestProvisioner extends Request {
    matrixWidgetToken?: string;
    matrixUserId: string;
}

export interface ProvisioningApiOpts {
    /**
     * Secret token for provisioning requests
     */
    provisioningToken: string;
    /**
     * For widget tokens, use this prefix.
     */
    widgetTokenPrefix?: string;
    /**
     * How long should a widget token last for?
     */
    widgetTokenLifetimeMs?: number;
    /**
     * Where are the files stored for the widget frontend. If undefined, do not host a frontend.
     */
    widgetFrontendLocation?: string;
    /**
     * Provide an existing express app to bind to.
     *
     * Note: start() and close() will no-op when this is used.
     */
    expressApp?: Application;
    /**
     * Prefix to use for the API. E.g. `/api` in `/api/v1/session`
     *
     * Default is `/api`.
     */
    apiPrefix?: string;
}


const DEFAULT_WIDGET_TOKEN_PREFIX = "br-sdk-utoken-";
const DEFAULT_WIDGET_TOKEN_LIFETIME_MS = 24 * 60 * 60 * 1000; // One day

/**
 * The provisioning API serves two classes of clients:
 *  - Integration managers which provide a unique secret token, and a userId
 *  - Widget users which provide a openId token.
 */
export abstract class ProvisioningApi {
    private app: Application;
    private server?: Server;
    protected baseRoute: Router;
    private readonly widgetTokenPrefix: string;
    private readonly widgetTokenLifetimeMs: number;
    constructor(protected store: ProvisioningStore, private opts: ProvisioningApiOpts) {
        this.app = express();
        this.app.use((req, _res, next) => {
            log.info(`${req.method} ${req.path} ${req.ip || ''} ${req.headers["user-agent"] || ''}`);
            next();
        });

        this.widgetTokenPrefix = opts.widgetTokenPrefix || DEFAULT_WIDGET_TOKEN_PREFIX;
        this.widgetTokenLifetimeMs = opts.widgetTokenLifetimeMs || DEFAULT_WIDGET_TOKEN_LIFETIME_MS;
        this.opts.apiPrefix = opts.apiPrefix || "/api";

        this.app.get('/health', this.getHealth.bind(this));
        this.app.use(cors());
        if (opts.widgetFrontendLocation) {
            this.app.use('/', express.static(opts.widgetFrontendLocation));
        }

        this.baseRoute = router();
        this.baseRoute.use(express.json());
        // Unsecured requests
        this.baseRoute.post(`/v1/exchange_openid`, (req, res) => this.postExchangeOpenId(req, res));

        // Secure requests
        // addRoute ensures all successful requests are of type ProvisioningRequest
        this.baseRoute.use("/", this.authenticateRequest.bind(this));
        this.addRoute("get", "/v1/session", this.getSession.bind(this));
        this.addRoute("delete", "/v1/session", this.deleteSession.bind(this));
        this.addRoute("delete", "/v1/session/all", this.deleteAllSessions.bind(this));
        this.baseRoute.use(this.onError);

        this.app.use(this.opts.apiPrefix, this.baseRoute);
    }

    public start(port: number, hostname = "0.0.0.0", backlog = 10): void {
        if (this.opts.expressApp) {
            log.warn(`Ignoring call to start(), api configured to use parent express app`);
            return;
        }
        log.info(`Widget API listening on port ${port}`)
        this.server = this.app.listen(port, hostname, backlog);
    }

    public close(): void {
        this.server?.close();
    }

    public addRoute(
        method: "get"|"post"|"delete"|"put",
        path: string,
        handler: (req: ProvisioningRequest, res: Response, next: NextFunction) => void|Promise<void>,
        fnName?: string,): void {
        this.baseRoute[method](path, (req, res, next) => {
            const expRequest = req as ExpRequestProvisioner;
            const provisioningRequest = new ProvisioningRequest(
                expRequest,
                expRequest.matrixUserId,
                expRequest.matrixWidgetToken ? "widget" : "provisioner",
                expRequest.matrixWidgetToken,
                fnName,
            );
            handler(provisioningRequest, res, next);
        });
    }

    private authenticateRequest(req: Request, res: Response, next: NextFunction) {
        const authHeader = req.header("Authorization")?.toLowerCase();
        if (!authHeader) {
            throw new ApiError('No Authorization header', ErrCode.BadToken);
        }
        const token = authHeader.startsWith("bearer ") && authHeader.substr("bearer ".length);
        if (!token) {
            return;
        }
        const requestProv = (req as ExpRequestProvisioner);
        if (!this.opts.provisioningToken && req.body.userId) {
            throw new ApiError('Provisioing feature disabled', ErrCode.DisabledFeature);
        }
        if (token === this.opts.provisioningToken) {
            // Integration managers splice in the user_id in the body.
            const userId = req.body?.user_id;
            if (!userId) {
                throw new ApiError('No userId in body', ErrCode.BadValue);
            }
            requestProv.matrixUserId = userId;
            requestProv.matrixWidgetToken = undefined;
            next();
            return;
        }
        this.store.getSessionForToken(token).then(session => {
            if (session.expiresTs < Date.now()) {
                this.store.deleteSession(token);
                throw Error('Token expired');
            }

            requestProv.matrixUserId = session.userId;
            requestProv.matrixWidgetToken = token;
            next();
        }).catch(() => {
            res.status(401).send({
                error: 'Could not authenticate with token'
            });
        });
    }


    private getHealth(req: Request, res: Response) {
        res.send({ok: true});
    }

    private getSession(req: ProvisioningRequest, res: Response) {
        res.send({
            userId: req.userId,
            type: req.requestSource,
        });
    }

    private async deleteSession(req: ProvisioningRequest, res: Response) {
        if (!req.widgetToken) {
            req.log.debug("tried to delete session");
            throw new ApiError("Session cannot be deleted", ErrCode.UnsupportedOperation);
        }
        try {
            await this.store.deleteSession(req.widgetToken);
        }
        catch (ex) {
            req.log.error("Failed to delete session", ex);
            throw new ApiError("Session could not be deleted", ErrCode.Unknown);
        }
    }

    private async deleteAllSessions(req: ProvisioningRequest, res: Response) {
        if (!req.widgetToken) {
            req.log.debug("tried to delete session");
            throw new ApiError("Session cannot be deleted", ErrCode.UnsupportedOperation);
        }
        try {
            await this.store.deleteAllSessions(req.userId);
        }
        catch (ex) {
            req.log.error("Failed to delete all sessions", ex);
            throw new ApiError("Sessions could not be deleted", ErrCode.Unknown);
        }
    }

    private async postExchangeOpenId(req: Request, res: Response) {
        const server = req.body?.matrixServer;
        const openIdToken = req.body?.openIdToken;
        let url: string;
        // TODO: Need a MUCH better impl:
        try {
            const wellKnown = await axios.get<MatrixServerWellKnown>(`https://${server}/.well-known/matrix/server`, {
                validateStatus: null
            });
            if (wellKnown.status === 200) {
                url = `https://${wellKnown.data["m.server"]}`;
            }
            else {
                url = `https://${server}:8448`;
            }
        }
        catch (ex) {
            log.warn(`Failed to fetch the server URL for ${server}`, ex);
            throw new ApiError("Could not identify server url", ErrCode.BadOpenID);
        }

        // Now do the token exchange
        try {
            const response = await axios.get<{sub: string}>(`${url}/_matrix/federation/v1/openid/userinfo`, {
                params: {
                    access_token: openIdToken,
                },
            });
            if (!response.data.sub) {
                log.warn(`Server responded with invalid sub information for ${server}`, response.data);
                throw new ApiError("Server did not respond with the correct sub information", ErrCode.BadOpenID);
                return;
            }
            const userId = response.data.sub;
            const token = this.widgetTokenPrefix + uuid().replace(/-/g, "");
            const expiresTs = Date.now() + this.widgetTokenLifetimeMs;
            await this.store.createSession({
                userId,
                token,
                expiresTs,
            });
            res.send({ token, userId });
        }
        catch (ex) {
            log.warn(`Failed to exchnage the token for ${server}`, ex);
            throw new ApiError("Failed to exchange token", ErrCode.BadOpenID);

    // Needed so that _next can be defined in order to preserve signature.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    private onError(err: [unknown, ProvisioningRequest|Request], _req: Request, res: Response, _next: NextFunction) {
        if (!err) {
            return;
        }
        const [error, request] = err;
        if (request instanceof ProvisioningRequest) {
            request.log.error(error);
        }
        else {
            log.error(error);
        }
        if (res.headersSent) {
            return;
        }
        if (err instanceof ApiError) {
            err.apply(res);
        }
        else {
            new ApiError("An internal error occured").apply(res);
        }
    }
}