# Matrix Application Service Bridging Infrastructure
[![Build Status](https://travis-ci.org/matrix-org/matrix-appservice-bridge.svg?branch=master)](https://travis-ci.org/matrix-org/matrix-appservice-bridge)

This library sits on top of the
[core application service library](https://github.com/matrix-org/matrix-appservice-node)
and provides an API for setting up bridges quickly. Check out the
[HOW-TO](HOWTO.md) for a step-by-step tutorial on setting up a new bridge.

# API

A hosted reference can be found on
[GitHub Pages](http://matrix-org.github.io/matrix-appservice-bridge).
Alternatively, build the docs using `npm run gendoc`. Each component's class
constructor is exposed on `require("matrix-appservice-bridge")` so check each
class for more information on how to use each component.

# Architecture

```
 __________________________
|                          |
|   Your bridge e.g. IRC   |
|__________________________|
 __|___________________|___
|                          |
| matrix-appservice-bridge |
|__________________________|
 __|___________________|___
|                          |
|    matrix-appservice     |
|__________________________|

```

The bridge relies on `matrix-appservice` and `matrix-js-sdk` for their
AS API and CS API implementations respectively. The bridge manages state for
virtual users and provides many useful helper functions bridges may desire.

## Components
The bridge is formed around "components". You can pick and choose which
components you use, though some components depend upon other components.
All components operate on data models defined in the bridge. You can directly
construct components: the bridge exposes the class constructor.

### `BridgeStore`
Provides basic document store (key-value) CRUD operations.

### `UserBridgeStore`
Provides storage for matrix and remote users. Provides CRUD operations and
mapping between different types of users.

### `RoomBridgeStore`
Provides storage for matrix and remote rooms. Provides CRUD operations and
mapping between different types of rooms.

### `ClientFactory`
Provides a method to obtain a JS SDK `MatrixClient` in the context of a
particular `user_id` and/or `Request`. This is used to send messages as other
users.

### `Request` / `RequestFactory`
An abstraction provided to identify a single request through the bridge.
Can be used for request-context logging (each request has a unique ID)
and metrics (each request can succeed or fail and has timers for how long
they take to go through the bridge).

### `Intent`
Provides a way to perform Matrix actions by *intent* rather than by raw
API calls. This can be thought of as an extension to the client-server JS SDK.
For example, `intent.invite(roomId, invitee)` would make sure that you are
actually joined to the room `roomId` first (and will automatically join it if
you aren't) before trying to send the invite.

Performing actions by *intent* makes creating bridges a lot easier. For example,
if your bridge has no concept of inviting or joining rooms, then you don't need
to care about it either in the bridge. Simply calling
`intent.sendMessage(roomId, text)` would make sure that you are joined to the
room first before sending the message.

### `ConfigValidator`
Provides a way to validate a YAML file when provided with a schema file.
Useful for setting your bridge-specific configuration information.

### `Cli`
Processes command line arguments and runs the `Bridge`.

### `AppServiceBot`
A wrapper around the JS SDK `MatrixClient` designed for use by the application
service *itself*. Contains helper methods to get all rooms the AS is in, how
many virtual / real users are in each, etc.

### `Bridge`
The component which orchestrates other components: a "glue" component. Provides
a way to start the bridge. This is the component most examples use. Has
dependencies on most of the components listed above.

## `Logging`
This component exposes access to the bridges log reporter. To use, you should
install the optional packages `winston@3`, `winston-daily-rotate-file@2` and
`chalk@2` to get nice formatted log lines, otherwise it will default to the JS
console. To use the component, use `Logging.configure(configObject)` to setup
the logger, which takes the following options:
```javascript
{
    // A level to set the console reporter to.
    console: "error|warn|info|debug|off",

    // Format to append to log files.
    fileDatePattern: "YYYY-MM-DD",

    // Format of the timestamp in log files.
    timestampFormat: "MMM-D HH:mm:ss.SSS",

    // Log files to emit to, keyed of the minimum level they report.
    // You can leave this out, or set it to false to disable files.
    files: {
        // File paths can be relative or absolute, the date is appended onto the end.
        "abc.log" => "error|warn|info|debug|off",
    },

    // The maximum number of files per level before old files get cleaned
    // up. Use 0 to disable.
    maxFiles: 5,
}
```


You **MUST** configure the logger before anything will be emitted to the console.

You can then use `const log = Logging.Get(ModuleName)` to start logging to the reporter,
using the `log.error`, `log.warn`, `log.info` or `log.debug` functions. Arguments to these functions will
automatically be seralized if they aren't strings.

NOTE: ``opts.controller.onLog`` will override this, but if not set then the logging
transport is used.

## `RoomLinkValidator`
This component validates if a room can be linked to a remote channel based on
whether it conflicts with any rules given in a rule file. The filename is given
in `opts.roomLinkValidation.ruleFile` for `Bridge`, though you may also set the
rules as an object instead by setting `opts.roomLinkValidation.rules`.
The format for the file (in YAML) or the object is as follows:
```javascript
{
    // This rule checks the memberlist of a room to determine if it will let
    // the bridge create a link to the room. This is useful for avoiding conflicts
    // with other bridges.
    "userIds": {
        // Anyone in this set will be ALWAYS exempt from the conflicts rule.
        // Here anyone who's localpart starts with nice is exempt.
        "exempt": ["@nice+.:example.com"]
        // This is a regex that will exclude anyone who has "guy" at the end of their localpart.
        // evilbloke is also exempt.
        "conflict": ["@+.guy:example.com", "@evilbloke:example.com"]
    }
}
```

If you set `opts.roomLinkValidation.triggerEndpoint` to `true`, then you may use
`/_bridge/roomLinkValidator/reload` to reload the config from file. This endpoint
optionally takes the `filename` parameter if you want to reload the config from
another location.


## `RoomUpgradeHandler`
This component automatically handles [Room Upgrades](https://matrix.org/docs/spec/client_server/unstable.html#post-matrix-client-r0-rooms-roomid-upgrade)
by changing all associated room entries to use the new room id as well as leaving
and joining ghosts. It can also be hooked into so you can manually adjust entries,
or do an action once the upgrade is over.

This component is disabled by default but can enabled by simply defining `roomUpgradeOpts`
in the options given to the bridge (simply `{}` (empty object)). By default, users
will be copied on upgrade. Upgrade events will also be consumed by the bridge, and
will not be emitted by `onEvent`. For more information, see the docs.


## Data Models
 * `MatrixRoom` - A representation of a matrix room.
 * `RemoteRoom` - A representation of a third-party room.
 * `MatrixUser` - A representation of a matrix user.
 * `RemoteUser` - A representation of a third-party user.
