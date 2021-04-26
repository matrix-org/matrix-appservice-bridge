import inspector from 'inspector';
import express, { Application, Request, Response } from 'express';
import Logging from "./logging";

const log = Logging.get("DebugAPI");

export interface DebugApiOpts {
    inspector?: {
        port: number;
        host?: string;
    };
    port: number;
    host: string;
}

/**
 * A HTTP based Debug API for bridging
 */
export class DebugAPI {
    private app: Application;

    constructor(private opts: DebugApiOpts) {
        this.app = express();
        this.app.post("/inspector/start", this.onInspectorStart);
        this.app.post("/inspector/stop", this.onInspectorStop);
    }

    public async start(): Promise<unknown> {
        return new Promise<void>((res, rej) => {
            this.app.once("error", rej);
            this.app.listen(this.opts.port, this.opts.host, res);
        });
    }

    public addRoute(method: "get"|"post"|"put"|"delete", path: string,
        callback: (req: Request, res: Response) => void) {
        this.app[method](path, callback);
    }

    private onInspectorStart(_: Request, res: Response) {
        if (!this.opts.inspector) {
            res.status(500).send({"error": "Inspector not configured"});
            return;
        }
        inspector.open(this.opts.inspector.port, this.opts.inspector.host || this.opts.host);
        res.status(200).send({})
    }

    private onInspectorStop(_: Request, res: Response) {
        if (!this.opts.inspector) {
            res.status(500).send({"error": "Inspector not configured"});
            return;
        }
        inspector.close();
        res.status(200).send({})
    }
}
