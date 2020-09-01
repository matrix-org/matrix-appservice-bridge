/*
Copyright 2020 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at
    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

let isFirstUseOfWrap = true;

export namespace unstable {
    
    /**
     * Append the old error message to the new one and keep its stack trace.
     * Example:
     *     throw wrapError(e, HighLevelError, "This error is more specific");
     */
    export function wrapError<T extends Error>(
        oldError: Error|string,
        newErrorType: { new (message: string): T },
        message: string,
    ) {
        const newError = new newErrorType(message);
        let appendMsg;
        if (oldError instanceof Error) {
            appendMsg = oldError.message;
            newError.stack = oldError.stack;
        }
        else {
            appendMsg = oldError.toString();
        }
        newError.message += ":\n" + appendMsg;
        return newError;
    }
    
    /**
    * @deprecated Use {@link wrapError}
    */
    export function wrap<T extends Error>(
        oldError: Error|string,
        newErrorType: { new (message: string): T },
        message: string) {
           if (isFirstUseOfWrap) {
                console.warn("matrix-appservice-bridge: Use of `unstable.wrap` is deprecated. Please use `unstable.wrapError`.")
                isFirstUseOfWrap = false;   
           }
           return wrapError(oldError, newErrorType, message);
    }

    /**
     * Base Error for when the bride can not handle the event.
     */
    export class EventNotHandledError extends Error {
        protected reason: string;
        constructor(message="The event could not be handled by the bridge") {
            super(message);
            this.name = "EventNotHandledError";
            this.reason = "m.event_not_handled";
        }
    }

    /**
     * The bridge decides that the event is too old to be sent.
     */
    export class EventTooOldError extends EventNotHandledError {
        constructor(message="The event was too old to be handled by the bridge") {
            super(message);
            this.name = "EventTooOldError";
            this.reason = "m.event_too_old";
        }
    }

    /**
     * An unexpected internal error occured while the bridge handled the event.
     */
    export class BridgeInternalError extends EventNotHandledError {
        constructor(message="The bridge experienced an internal error") {
            super(message);
            this.name = "EventTooOldError";
            this.reason = "m.internal_error";
        }
    }

    /**
     * The foreign network errored and the event couldn't be delivered.
     */
    export class ForeignNetworkError extends EventNotHandledError {
        constructor(message="The foreign network experienced an error") {
            super(message);
            this.name = "ForeignNetworkError";
            this.reason = "m.foreign_network_error";
        }
    }

    /**
     * The event is not understood by the bridge.
     */
    export class EventUnknownError extends EventNotHandledError {
        constructor(message="The event is not known to the bridge") {
            super(message);
            this.name = "EventUnknownError";
            this.reason = "m.event_unknown";
        }
    }
}
