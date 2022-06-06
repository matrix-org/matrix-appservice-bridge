import { Logger, Request } from "..";
import crypto from "crypto";
import { Request as ExpressRequest } from "express";
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
    ReqQuery = ParsedQs> extends Request<void> {

    constructor(
        public readonly expressReq: ExpressRequest<Params, ResBody, ReqBody, ReqQuery>,
        public readonly userId: string|null,
        public readonly requestSource: "widget"|"provisioner",
        public readonly widgetToken?: string,
        public readonly fnName?: string,
    ) {
        super({
            id: [Request.generateRequestId(), fnName].filter(n => !!n).join(" "),
            data: undefined,
        }, 'ProvisionRequest');
        this.fnName = fnName || expressReq.path;
        this.debug(`Request ${userId} (${requestSource}) ${this.fnName}`);
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
