import crypto from "crypto";
import { ThinRequest, Logger } from "..";
import { Request } from "express";
import { ParsedQs } from "qs";

// Methods supported by a express.Router
export type Methods = 'all' |
'get' |
'post' |
'put' |
'delete' |
'patch' |
'options' |
'head' |
'checkout' |
'connect' |
'copy' |
'lock' |
'merge' |
'mkactivity' |
'mkcol' |
'move' |
'm-search' |
'notify' |
'propfind' |
'proppatch' |
'purge' |
'report' |
'search' |
'subscribe' |
'trace' |
'unlock' |
'unsubscribe';

export class ProvisioningRequest<
    // These types are taken from express.Request
    Params = {[key: string]: string},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ResBody = any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ReqBody = any,
    ReqQuery = ParsedQs> implements ThinRequest {
    public readonly log: Logger;
    public readonly id: string;

    constructor(
        public readonly expressReq: Request<Params, ResBody, ReqBody, ReqQuery>,
        public readonly userId: string|null,
        public readonly requestSource: "widget"|"provisioner",
        public readonly widgetToken?: string,
        public readonly fnName?: string,
    ) {
        this.id = crypto.randomBytes(4).toString('hex');
        this.fnName = fnName || expressReq.path;
        this.log = new Logger('ProvisionRequest', { requestId: [this.id, fnName].filter(n => !!n).join(" ") });
        this.log.debug(`Request ${userId} (${requestSource}) ${this.fnName}`);
    }

    public getId(): string {
        return this.id;
    }

    get body(): ReqBody {
        return this.expressReq.body;
    }

    get params(): Params {
        return this.expressReq.params;
    }

    get query(): ReqQuery {
        return this.expressReq.query;
    }
}
