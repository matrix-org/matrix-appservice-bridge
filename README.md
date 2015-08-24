# Matrix Application Service Bridging Infrastructure
This library sits on top of the
[core application service library](https://github.com/matrix-org/matrix-appservice-node)
and provides an API for setting up bridges quickly. Check out the [HOW-TO](HOWTO.md) for
a step-by-step tutorial on setting up a new bridge.

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
All components operate on data models defined in the bridge. You directly
construct components: the bridge exposes the class constructor.

### `UserBridgeStore`
Provides storage for matrix and jungle users. Provides CRUD operations and
mapping between different types of users.

### `RoomBridgeStore`
Provides storage for matrix and jungle rooms. Provides CRUD operations and
mapping between different types of rooms.

### `ClientFactory` [TODO]
Provides a method to obtain a JS SDK `MatrixClient` in the context of a
particular `user_id`. This is used to send messages as other users.

### `Bridge` [TODO]
Provides a way to start the bridge. Wraps the `ApplicationService` and
`AppServiceRegistration` classes of `matrix-appservice`.

### `Request` [TODO]
An abstraction provided to identify a single request through the bridge.
Can be used for request-context logging (each request has a unique ID)
and metrics (each request can succeed or fail and has timers for how long
they take to go through the bridge).

### `ConfigValidator` [TODO]
Provides a way to validate a YAML file when provided with a schema file.
Useful for setting your bridge-specific configuration information.

### `AppServiceBot` [TODO]
A wrapper around the JS SDK `MatrixClient` designed for use by the application
service *itself*. Contains helper methods to get all rooms the AS is in, how
many virtual / real users are in each, etc.

### Data Models
 * `MatrixRoom` - A representation of a matrix room.
 * `JungleRoom` - A representation of a third-party room.
 * `MatrixUser` - A representation of a matrix user.
 * `JungleUser` - A representation of a third-party user.


# API

A hosted reference can be found on GitHub Pages (TODO). Each component's class
constructor is exposed on `require("matrix-appservice-bridge")` so check each
class for more information on how to use each component.

## A word on terminology

This library can be used to bridge with many different networks. This makes it
hard to identify the "outside network" via a single consistent name for types
and function names. This library refers to the "outside network" as the
`Jungle`: after all, it *is* a jungle out there. This name makes it easier to
intuit what `getJungleId` means, versus the alternative `getBridgedUserId` which
could be confused with Matrix's `user_id`. This also makes it a lot easier to
`grep`!
