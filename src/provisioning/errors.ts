import { Response } from "express";

export enum ErrCode {
    // Errors are prefixed with M_AS_
    /**
     * Generic failure, unknown reason
     */
    Unknown = "M_AS_UNKNOWN",
    /**
     * The operation was not supported by this connection
     */
    UnsupportedOperation = "M_AS_UNSUPPORTED_OPERATION",
    /**
     * A bad value was given to the API.
     */
    BadValue = "M_AS_BAD_VALUE",
    /**
     * The secret token provided to the API was invalid or not given.
     */
    BadToken = "M_AS_BAD_TOKEN",
    /**
     * The requested feature is not enabled in the bridge.
     */
    DisabledFeature = "M_AS_DISABLED_FEATURE",
    /**
     * Couldn't complete the openId process.
     */
    BadOpenID = "M_AS_BAD_OPENID",

    Ratelimited = "M_AS_LIMIT_EXCEEDED"
}

const ErrCodeToStatusCode: Record<ErrCode, number> = {
    M_AS_UNKNOWN: 500,
    M_AS_UNSUPPORTED_OPERATION: 400,
    M_AS_BAD_VALUE: 400,
    M_AS_BAD_TOKEN: 401,
    M_AS_DISABLED_FEATURE: 500,
    M_AS_BAD_OPENID: 500,
    M_AS_LIMIT_EXCEEDED: 429,
}

export class ApiError extends Error {
    constructor(
        public readonly error: string,
        public readonly errcode = ErrCode.Unknown,
        public readonly statusCode = -1,
        public readonly additionalContent: Record<string, unknown> = {},
    ) {
        super(`API error ${errcode}: ${error}`);
        if (statusCode === -1) {
            this.statusCode = ErrCodeToStatusCode[errcode];
        }
    }

    get jsonBody(): {errcode: string, error: string} {
        return {
            errcode: this.errcode,
            error: this.error,
            ...this.additionalContent,
        }
    }

    public apply(response: Response): void {
        response.status(this.statusCode).send(this.jsonBody);
    }
}
