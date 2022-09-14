# Matrix Application Service Bridging Infrastructure

This library sits on top of the
[core application service library](https://github.com/matrix-org/matrix-appservice-node)
and provides an API for setting up bridges quickly. Check out the
[HOW-TO](HOWTO.md) for a step-by-step tutorial on setting up a new bridge.

`matrix-appservice-bridge` requires Node JS 16.x or greater.

If you are looking to contribute to this library, please check out our [CONTRIBUTING](./CONTRIBUTING.md) guide.

# API

A hosted reference can be found on
[GitHub Pages](http://matrix-org.github.io/matrix-appservice-bridge).
Alternatively, build the docs using `yarn gendoc`. Each component's class
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

The bridge relies on [`matrix-appservice`](https://github.com/matrix-org/matrix-appservice-node)
and [`matrix-bot-sdk`](https://github.com/turt2live/matrix-bot-sdk) for their of the [Application
Service API](https://spec.matrix.org/latest/application-service-api/) (AS API) and [Client-Server
API](https://spec.matrix.org/latest/client-server-api/) (CS API) respectively. The bridge manages
state for virtual users and provides many useful helper functions bridges may desire.

## Components
The bridge is formed around "components". You can pick and choose which
components you use, though some components depend upon other components.
All components operate on data models defined in the bridge. You can directly
construct components: the bridge exposes the class constructor.

### `Bridge`
The component which orchestrates other components: a "glue" component. Provides
a way to start the bridge. This is the component most examples use. Has
dependencies on most of the components listed above.

### `BridgeStore`
Provides basic document store (key-value) CRUD operations.

### `UserBridgeStore`
Provides storage for matrix and remote users. Provides CRUD operations and
mapping between different types of users.

### `RoomBridgeStore`
Provides storage for matrix and remote rooms. Provides CRUD operations and
mapping between different types of rooms.

### `EventBridgeStore`
Provides storage for matrix and remote event ids.

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

## `Logging`

This component exposes access to the bridges log reporter.
To use the component, use `Logger.configure` to setup 
the logger.

```js
// Configure the logger by providing these options
Logger.configure({ level: "info" });

// In each module, instantiate the Logger class with a module name.
const log = new Logger('MyModule');

// Then log away!
log.info('Hello, this is a log from my module');
log.debug('Some debug info');
log.error('Oh no, something went wrong!', new Error('an error'));
```

You **MUST** configure the logger before anything will be emitted to the console.

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
        // Here anyone whose localpart starts with nice is exempt.
        "exempt": ["@nice.+:example.com"]
        // This is a regex that will exclude anyone who has "guy" at the end of their localpart.
        // evilbloke is also exempt.
        "conflict": ["@.+guy:example.com", "@evilbloke:example.com"]
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


## Signaling Bridge Errors

**Warning**: This feature is experimental and not part of the matrix specification
yet. [MSC2162](https://github.com/matrix-org/matrix-doc/pull/2162) is currently ongoing
which means that changes will likely happen to the format of the errors. Do not use
this in production bridges.

This section applies when you are using `Bridge` and want to notify your users
about problems while processing their events.

One thing the bridge requires you to do is fulfilling or rejecting the
`request` promise which is handed to you as argument of the
`controller.onEvent` callback. When rejecting the promise, the `Error` you
reject with will indicate to the bridge library how to behave:

- On an `EventNotHandledError` (and all its subtypes) the bridge will declare
  the event as permanently failed. It will mark it as such by sending a
  `de.nasnotfound.bridge_error` room event, which will make clients show an
  error message to their users.
- On all other `Error` types no message is sent to the clients. The bridge
  still uses the information that the event was handled for queuing purposes.
