1.3.7 (2017-03-02)
==================

Allow the default SUCCESS/FAILED log lines to be turned off via `opts.logRequestOutcome`.

1.3.6 (2017-01-17)
==================

Fixed a bug in the `Intent` class which could cause message sending to fail
with `M_FORBIDDEN` errors due to not being joined to the room. The class
now handles this case and will join the room before resending the message.

1.3.5 (2017-01-04)
==================

Specify a `localTimeoutMs` of 2 minutes for every outbound HTTP request to
prevent connections from wedging if a response is never returned.

1.3.4 (2016-12-15)
==================

Added `AppServiceBot` function `getJoinedRooms` for getting a list of joined
room IDs for the AS bot and function `getJoinedMembers` for getting a map of
joined user IDs for the given room ID. The values in the map are with a
`display_name` and `avatar_url` properties.

Switched the prometheus metrics from using the `prometheus-client` library to
the `prom-client` library.

Added `PrometheusMetrics` functions `addTimer` and `startTimer` for manipulating
timer metrics for the bridge.

Bumped matrix-org/matrix-js-sdk dependency from `0.5.3` to `0.7.2`. See
[the matrix-js-sdk changelog](https://github.com/matrix-org/matrix-js-sdk/blob/master/CHANGELOG.md#changes-in-072-2016-12-15)

1.3.3 (2016-11-24)
==================
Metrics.js has been refactored from matrix-appservice-{slack,gitter} to this repo. Bridge intent objects and Matrix client API calls are now counted as part of the new metrics functionality.

Added `RoomBridgeStore` function `removeEntriesByRemoteId` to remove entries in the DB with a given remote ID.

Added `StateLookup` function `untrackRoom` to stop further tracking of state events in a given room and delete existing stored state for it.

Use `r0/sync` rather than `v1/initialSync` for `AppServiceBot` function `getMemberLists`. A filter has also been added to limit the number events sent across.

1.3.2 (2016-10-25)
==================
Bump dependency on matrix-org/matrix-appservice-node from `0.3.1` to `0.3.3`. See [the matrix-appservice-node changelog](https://github.com/matrix-org/matrix-appservice-node/blob/1ff56e9c11d8536f2ce7043279818bfa61b8fa91/CHANGELOG.md#v033matrix-appservice-node#).

1.3.1 (2016-10-19)
==================
Third Party Lookup:
 - 3PL/3PU lookups now return lists instead of individual results
 - Reverse lookups now possible

Added Intent function `sendReadReceipt`

`ContentRepo` now exported as pass-through from `matrix-js-sdk`.

1.3.0 (2016-09-09)
==================
Improved queueing of pending messages to send to the homeserver to store one
queue per destination room. This stops large amounts of traffic to a busy room
from holding up traffic on other rooms.

Added a `getProfileInfo` method on user intent objects to wrap the
corresponding `matrix-js-sdk` client method.

Added a convenience in the bridge controller to wrap the new `/thirdparty`
API.

1.2.1 (2016-08-08)
==================
Increased the default dependency of the JS SDK to 0.5.3. This is to allow
file uploads to work correctly.

1.2.0 (2016-07-26)
==================
Added new `RoomBridgeStore` methods: `getEntriesByLinkData` and
`removeEntriesByLinkData`. See docs for function signatures and usage.

1.1.1 (2016-07-11)
==================
Added a new component: `StateLookup`. Added a new `Bridge` callback:
`onAliasQueried(alias, roomId)`.

1.0.1 (2016-06-21)
==================
Added `disableContext` option to the `Bridge` class.

1.0.0 (2016-06-17)
==================
Modify the internal storage format of `RoomBridgeStore`. Change the public API
of `RoomBridgeStore` to reflect the new storage format.

**This is a backwards-incompatible database format change.** If you wish to
upgrade from a 0.x version, you will need to write a script to upgrade your
database.

The storage format has been changed to improve performance when querying
room mappings.

0.3.7 (2016-06-14)
==================
Reduced the number of queries run when store methods are called. Added new
`batch` functions to reduce database queries at the application level.

0.3.6 (2016-06-07)
==================
The bridge library will now use `r0 /register`. Due to bugs inside Synapse, this
means the **minimum supported Synapse version is 0.15.0-rc1** and above.

0.3.5 (2016-04-14)
==================
Fixed an issue where the bridge library would attempt to use v1 APIs on r0 paths.
This was caused by increasing the `matrix-js-sdk` dependency which now defaults
to r0 paths. Fixed various `matrix-js-sdk` breaking API changes such as the
change to the `register()` function.

The bridge library still uses v1 `/initialSync`.

0.3.4 (2016-04-14)
==================
Fixed a critical bug which would prevent the callback for HTTP requests from
firing if the request returned a network error such as ECONNRESET. This affected
all users of `ClientFactory` who attached a logging function via `setLogFunction`.

0.3.3 (2016-04-12)
==================
Increased the default `matrix-js-sdk` dependency used by `ClientFactory` to 0.4.1.

0.3.2 (2016-03-18)
==================
Improved JSDoc on various functions to clear up ambiguity. In addition:

Changes on the `Intent` class:
 - Fixed a bug which could cause `createRoom` to fail if the `Intent` was scoped to the bot user.
 - Add intent option `dontCheckPowerLevel` to skip checking the required power level before sending events.
 - Added `getClient()` to retrieve the underlying `MatrixClient` instance.
 - Added `createAlias(alias, roomId)`.

Changes on the `Bridge` class:
 - Modified the default request error callback to always log 'FAILED'.
 - Added `loadDatabases()` which can be invoked prior to `run()` for bridge setup.
 - Expose `Intent` constructor options in the bridge `opts`.

Changes on the `MatrixUser` class:
 - Added `get(key)` and `set(key, val)` to allow arbitrary data to be stored on Matrix users.

Changes on the `RoomBridgeStore` class:
 - Added `unlinkByData()`
 - Added the concept of "Link Keys" to clobber links based on something other than the tuple of the room IDs.

Changes on the `UserBridgeStore` class:
 - Added `getByMatrixData()`.

0.3.1 (2016-03-07)
==================
Dependency on `matrix-appservice` was bumped to fix a critical bug.

0.3.0 (2016-03-03)
==================
**BREAKING CHANGE** : An `id` field is required by all registration files as a result of bumping the dependency
of `matrix-appservice` to `0.3.0`.

0.1.5 (2016-01-29)
==================
Added the following `Bridge` function:
 - `Bridge.getClientFactory()`

Do not log values returned by resolved `Requests`, only on errors.

0.1.4 (2016-01-28)
==================
Adjusted the promise returned by the event listener the `Bridge` class attaches
to `AppService`. This is mainly for testing purposes.

0.1.3 (2016-01-27)
==================
More functions/options have been added to the `Cli` class:
 - `enableLocalpart`: Set `true` to enable the `--localpart [-l]` flag.
 - The CLI flag `--file [-f]` has been added. This represents the location of the
   registration file.
 - The `run()` function now includes the loaded `AppServiceRegistration` instance
   as an argument.

Bug fixes on the `Cli` class:
 - When `generateRegistration` is called, `this` is now bound to the `Cli` instance.

0.1.2 (2015-10-05)
==================
Implement the `affectsRegistration` option on `Cli`.

0.1.1 (2015-09-17)
==================
Added a HOW-TO.

Additions/improvements:
 - Added a utility method `Bridge.getIntentFromLocalpart`.
 - `Intent` instances will now ensure that the user is registered.
 - `AppServiceRegistration` from `matrix-appservice` is now exported on
   `matrix-appservice-bridge` so end-developers don't need to
   `npm install matrix-appservice`.

Breaking changes:
 - Changed the function signature of `Cli.generateRegistration` - the first
   arg is now an `AppServiceRegistration` and not a `String`.

0.1.0
=====
 - First release
