import { Application, default as express, NextFunction, Request, Response } from "express";
import cors from "cors";
import Logs, { LogWrapper } from "../components/logging";
import { Server } from "http";
import { ProvisioningStore } from "./store";
import axios from "axios";
import { v4 as uuid } from "uuid";

const log = Logs.get("ProvisioningApi");

interface MatrixServerWellKnown {
    "m.server": string;
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
}

export interface ProvisioningRequest extends Request {
    matrixUserId: string;
    matrixRequestType: "widget"|"provisioner";
    matrixSessionToken?: string;
    log: LogWrapper,
}

const DEFAULT_WIDGET_TOKEN_PREFIX = "br-sdk-utoken-";
const DEFAULT_WIDGET_TOKEN_LIFETIME_MS = 24 * 60 * 60 * 1000; // One day

/**
 * The provisioning API serves two classes of clients:
 *  - Integration managers which provide a unique secret token, and a userId
 *  - Widget users which provide a openId token.
 */
export class ProvisioningApi {
    protected app: Application;
    protected server?: Server;
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
        this.app.get('/health', this.getHealth.bind(this));
        this.app.use(cors());
        if (opts.widgetFrontendLocation) {
            this.app.use('/', express.static(opts.widgetFrontendLocation));
        }

        this.app.use(express.json());
        // Unsecured requests
        this.app.post('/api/v1/exchange_openid', (req, res) => this.postExchangeOpenId(req, res));

        // Secure requests
        this.app.use('/api', this.authenticateRequest.bind(this));
        // authenticateRequest ensures all successful requests are of type ProvisioningRequest
        this.app.get('/api/v1/session', (req, res) => this.getSession(req as ProvisioningRequest, res));
        this.app.delete('/api/v1/session', (req, res) => this.deleteSession(req as ProvisioningRequest, res));
        this.app.delete('/api/v1/session/all', (req, res) => this.deleteAllSessions(req as ProvisioningRequest, res));
    }

    public start(port: number, hostname = "0.0.0.0", backlog = 10): void {
        log.info(`Widget API listening on port ${port}`)
        this.server = this.app.listen(port, hostname, backlog);
    }

    public close(): void {
        this.server?.close();
    }

    private authenticateRequest(req: Request, res: Response, next: NextFunction) {
        const authHeader = req.header("Authorization")?.toLowerCase();
        if (!authHeader) {
            res.status(400).send({
                error: 'No Authorization header'
            });
            return;
        }
        const token = authHeader.startsWith("bearer ") && authHeader.substr("bearer ".length);
        if (!token) {
            return;
        }
        if (token === this.opts.provisioningToken) {
            // Integration managers splice in the user_id in the body.
            const userId = req.body?.user_id;
            if (!userId) {
                res.status(400).send({
                    error: 'No user_id in body'
                });
                return;
            }
            // Provisioning request.
            const provisioningRequest = req as ProvisioningRequest;
            provisioningRequest.matrixUserId = userId;
            provisioningRequest.matrixRequestType = "provisioner";
            provisioningRequest.log = Logs.get(`ProvisioningApi:provisioner:${userId}`);
            next();
            return;
        }
        this.store.getSessionForToken(token).then(session => {
            if (session.expiresTs < Date.now()) {
                this.store.deleteSession(token);
                throw Error('Token expired');
            }
            const provisioningRequest = req as ProvisioningRequest;
            provisioningRequest.matrixUserId = session.userId;
            provisioningRequest.matrixSessionToken = token;
            provisioningRequest.matrixRequestType = "widget";
            provisioningRequest.log = Logs.get(`ProvisioningApi:widget:${session.userId}`);
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
            userId: req.matrixUserId,
            type: req.matrixRequestType,
        });
    }

    private async deleteSession(req: ProvisioningRequest, res: Response) {
        if (!req.matrixSessionToken) {
            req.log.debug("tried to delete session");
            res.status(400).send({
                error: "Session cannot be deleted",
            });
            return;
        }
        try {
            await this.store.deleteSession(req.matrixSessionToken);
        }
        catch (ex) {
            req.log.error("Failed to delete session", ex);
            res.status(500).send({
                error: "Session could be deleted",
            });
        }
    }

    private async deleteAllSessions(req: ProvisioningRequest, res: Response) {
        if (!req.matrixSessionToken) {
            req.log.debug("tried to delete session");
            res.status(400).send({
                error: "Session cannot be deleted",
            });
            return;
        }
        try {
            await this.store.deleteAllSessions(req.matrixUserId);
        }
        catch (ex) {
            req.log.error("Failed to delete all sessions", ex);
            res.status(500).send({
                error: "Sessions could be deleted",
            });
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
            // TODO: need better fail logic
            res.status(500).send({
                error: "Failed to fetch server url",
            });
            return;
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
                res.status(500).send({
                    error: "Server did not respond with the correct sub information",
                });
                return;
            }
            const userId = response.data.sub;
            const token = this.widgetTokenPrefix + uuid().replace("-", "");
            const expiresTs = Date.now() + this.widgetTokenLifetimeMs;
            await this.store.createSession({
                userId,
                token,
                expiresTs,
            });
            res.send({ token, userId });
        }
        catch (ex) {
            log.warn(`Failed to exhcnage the token for ${server}`, ex);
            res.status(500).send({
                error: "Failed to exchange token",
            });
            return;
        }
    }
}
