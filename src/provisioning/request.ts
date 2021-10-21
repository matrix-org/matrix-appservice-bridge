import Logging, { LogWrapper } from "../components/logging";
import crypto from "crypto";
import { ThinRequest } from "..";

export default class ProvisioningRequest<
    Body = Record<string, unknown>, Params = Record<string, unknown>
    > implements ThinRequest {
    public readonly log: LogWrapper;
    public readonly id: string;


    constructor(
        private expressReq: {body: Body, params: Params, path?: string},
        public readonly userId: string,
        public readonly requestSource: "widget"|"provisioner",
        public readonly widgetToken?: string,
        public readonly fnName?: string,
    ) {
        this.id = crypto.randomBytes(4).toString('hex');
        this.fnName = fnName || expressReq.path;
        this.log = Logging.get(
            `ProvisionRequest ${[this.id, fnName].filter(n => !!n).join(" ")}`
        );
        this.log.info(`New request from ${userId} via ${requestSource}`);
    }

    public getId(): string {
        return this.id;
    }

    get body(): Body {
        return this.expressReq.body;
    }

    get params(): Params {
        return this.expressReq.params;
    }
}
