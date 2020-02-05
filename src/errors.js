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

/**
 * Append the old error message to the new one and keep its stack trace.
 * Example:
 *     throw wrap(e, HighLevelError, "This error is more specific");
 */
function wrap(
    oldError,
    newErrorType,
    ...args
) {
    const newError = new newErrorType(...args);
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
 * Ensures `args` contain an error message defaulting to `defaultMsg`.
 *
 * Modifies `args`.
 * @param {Array<str>} args The arguments to an Error object constructor.
 * @param {str} defaultMsg The error message to default to if there is none given.
 */
function defaultMessage(args, defaultMsg) {
    args[0] = args[0] || defaultMsg;
}

/**
 * Base Error for when the bride can not handle the event.
 */
class EventNotHandledError extends Error {
    constructor(...args) {
        defaultMessage(args, "The event could not be handled by the bridge");
        super(...args);
        this.name = "EventNotHandledError";
        this.reason = "m.event_not_handled";
    }
}

/**
 * The bridge decides that the event is too old to be sent.
 */
class EventTooOldError extends EventNotHandledError {
    constructor(...args) {
        defaultMessage(args, "The event was too old to be handled by the bridge");
        super(...args);
        this.name = "EventTooOldError";
        this.reason = "m.event_too_old";
    }
}

/**
 * An unexpected internal error occured while the bridge handled the event.
 */
class BridgeInternalError extends EventNotHandledError {
    constructor(...args) {
        defaultMessage(args, "The bridge experienced an internal error");
        super(...args);
        this.name = "EventTooOldError";
        this.reason = "m.internal_error";
    }
}

/**
 * The foreign network errored and the event couldn't be delivered.
 */
class ForeignNetworkError extends EventNotHandledError {
    constructor(...args) {
        defaultMessage(args, "The foreign network experienced an error");
        super(...args);
        this.name = "ForeignNetworkError";
        this.reason = "m.foreign_network_error";
    }
}

/**
 * The event is not understood by the bridge.
 */
class EventUnknownError extends EventNotHandledError {
    constructor(...args) {
        defaultMessage(args, "The event is not known to the bridge");
        super(...args);
        this.name = "EventUnknownError";
        this.reason = "m.event_unknown";
    }
}

module.exports = {
    wrap,
    EventNotHandledError,
    EventTooOldError,
    BridgeInternalError,
    ForeignNetworkError,
    EventUnknownError,
}
