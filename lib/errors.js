/**
 * Append the old error message to the new one and keep its stack trace.
 * Example:
 *     throw wrap(e, HighLevelError, "This error is more specific");
 */
function wrap(
    old_error,
    new_error_type,
    ...args
) {
    const new_error = new new_error_type(...args);
    let append_msg;
    if (old_error instanceof Error) {
        append_msg = old_error.message;
        new_error.stack = old_error.stack;
    }
    else {
        append_msg = old_error.toString();
    }
    new_error.message += ":\n" + append_msg;
    return new_error;
}

/**
 * Sets the default message for the given error arguments.
 */
function default_message(args, msg) {
    if (!(0 in args)) {
        args[0] = msg;
   }
}

/**
 * Base Error for when the bride can not handle the event.
 */
class EventNotHandledError extends Error {
    constructor(...args) {
        default_message(args, "The event could not be handled by the bridge");
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
        default_message(args, "The event was too old to be handled by the bridge");
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
        default_message(args, "The bridge experienced an internal error");
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
        default_message(args, "The foreign network experienced an error");
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
        default_message(args, "The event is not known to the bridge");
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
