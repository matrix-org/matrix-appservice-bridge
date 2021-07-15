2.7.0 (2021-07-15)
==================

Features
--------

- Export `matrix-appservice` classes and interfaces ([\#317](https://github.com/matrix-org/matrix-appservice-bridge/issues/317))
- Add `intent.ensureProfile` function. ([\#318](https://github.com/matrix-org/matrix-appservice-bridge/issues/318))
- Validate that the sender of a message edit matches the original sender. ([\#329](https://github.com/matrix-org/matrix-appservice-bridge/issues/329))


Bugfixes
--------

- Renamed `MSC2364Content` interface to `MSC2346` as the original name was a typo. ([\#322](https://github.com/matrix-org/matrix-appservice-bridge/issues/322))


Deprecations and Removals
-------------------------

- The `master` branch for `https://github.com/matrix-org/matrix-appservice-bridge` has been deleted. Projects should use the latest release/tag if currently depending on `master`. `develop` will continue to serve as the bleeding edge. ([\#320](https://github.com/matrix-org/matrix-appservice-bridge/issues/320))


Internal Changes
----------------

- Use `yarn` for dependency management. ([\#316](https://github.com/matrix-org/matrix-appservice-bridge/issues/316))
- Update typedoc to `0.20.x` ([\#322](https://github.com/matrix-org/matrix-appservice-bridge/issues/322))


2.6.1 (2021-06-02)
==================

This is a important hotfix release to fix an issue where the room upgrade handling would not verify that the new room
was a precessor of the old room. All bridges making use of the room upgrade handling feature should update.

Bugfixes
--------

- Fix an issue where the room upgrade handler would not check the `m.room.create` event when traversing an upgrade. ([\#330](https://github.com/matrix-org/matrix-appservice-bridge/issues/330))


2.6.0 (2021-03-16)
===================

No significant changes.


2.6.0-rc1 (2021-03-04)
===================

Features
--------

- Add the `BridgeInfoStateSyncer` helper component to sync MSC2346 format state events to rooms. ([\#312](https://github.com/matrix-org/matrix-appservice-bridge/issues/312))


Bugfixes
--------

- Ensure that the Intent room state cache is invalidate when the room state changes. ([\#310](https://github.com/matrix-org/matrix-appservice-bridge/issues/310))
- Use `type=m.login.application` when registering appservice users, to comply with the spec. ([\#315](https://github.com/matrix-org/matrix-appservice-bridge/issues/315))


Internal Changes
----------------

- Upgrade matrix-appservice-node to 0.8.0 ([\#311](https://github.com/matrix-org/matrix-appservice-bridge/issues/311))


2.5.0 (2021-02-10)
===================

No significant changes.


2.5.0-rc1 (2021-01-29)
=======================

Features
--------

- Allow for returning `roomId` in `onAliasQuery` which facilitates handling room creation yourself. ([\#288](https://github.com/matrix-org/matrix-appservice-bridge/issues/288))
- Allow the `Bridge` to be initalised without starting the HTTP listener. ([\#299](https://github.com/matrix-org/matrix-appservice-bridge/issues/299))
- Add `Intent.resolveRoom` function ([\#301](https://github.com/matrix-org/matrix-appservice-bridge/issues/301))


Bugfixes
--------

- Fix a case where an encrypted bridge may stop syncing for some users of the bridge ([\#285](https://github.com/matrix-org/matrix-appservice-bridge/issues/285))
- Fix onAliasQuery tests which would pass no matter if they failed ([\#289](https://github.com/matrix-org/matrix-appservice-bridge/issues/289))
- Fix regex complexity vulnerability in highlight.js (GHSA-7wwv-vh3v-89cq) ([\#290](https://github.com/matrix-org/matrix-appservice-bridge/issues/290))
- Fix a bug where /metrics would report empty values. ([\#296](https://github.com/matrix-org/matrix-appservice-bridge/issues/296))
- Fix a bug that would cause membership queue request failures to not be reported under the `membershipqueue_reason` metric ([\#300](https://github.com/matrix-org/matrix-appservice-bridge/issues/300))
- Fix Winston logging errors if the bridge hadn't called Logger.configure yet ([\#302](https://github.com/matrix-org/matrix-appservice-bridge/issues/302))


Internal Changes
----------------

- Improve some TypeScript return types ([\#292](https://github.com/matrix-org/matrix-appservice-bridge/issues/292))
- Update dependencies. We now use Typescript 4.1 which means that promiseutil.Defer now strictly checks resolve types. ([\#295](https://github.com/matrix-org/matrix-appservice-bridge/issues/295))
- Update `matrix-js-sdk` to `9.5.0` ([\#303](https://github.com/matrix-org/matrix-appservice-bridge/issues/303))
- Fetch metrics asynchronously ([\#304](https://github.com/matrix-org/matrix-appservice-bridge/issues/304))


2.4.0 (2020-12-01)
===================

No significant changes.


2.4.0-rc2 (2020-11-23)
=======================

Bugfixes
--------

- Fixed a issue the membership queue where a failed action would cause the `membershipqueue_pending` metric to increase. ([\#283](https://github.com/matrix-org/matrix-appservice-bridge/issues/283))


2.4.0-rc1 (2020-11-20)
=======================

Features
--------

- Add function `registerMetrics` to `MembershipQueue` to track metrics. ([\#276](https://github.com/matrix-org/matrix-appservice-bridge/issues/276))
- Add `defaultTtl` option to `MembershipQueue` to expire membership that is too old. ([\#277](https://github.com/matrix-org/matrix-appservice-bridge/issues/277))
- Logs from `matrix-js-sdk` will now be passed through the bridge `Logger` to keep logging in one place. ([\#280](https://github.com/matrix-org/matrix-appservice-bridge/issues/280))


Bugfixes
--------

- Add a script to automatically generate documentation for a release. ([\#275](https://github.com/matrix-org/matrix-appservice-bridge/issues/275))
- Fix a bug where `intent.uploadContent` would return the full JSON response of an upload rather than it's MXC url. ([\#279](https://github.com/matrix-org/matrix-appservice-bridge/issues/279))


2.3.1 (2020-11-06)
=======================

Bugfixes
--------

- Remove `winston-daily-rotate-file` side-effects which can throw errors with some installed `winston` versions ([\#264](https://github.com/matrix-org/matrix-appservice-bridge/issues/264))
- Fixed a bug where encrypted events may be handled twice. ([\#267](https://github.com/matrix-org/matrix-appservice-bridge/issues/267))
- Update `matrix-appservice` dependency to 0.7.1 to fix a bug where `msc2409.push_ephemeral` would be required in the registration file. ([\#270](https://github.com/matrix-org/matrix-appservice-bridge/issues/270))


Improved Documentation
----------------------

- Render various opts objects in the documentation that were missed last time ([\#268](https://github.com/matrix-org/matrix-appservice-bridge/issues/268))
- Add contributing docs to make first time contributions easier ([\#269](https://github.com/matrix-org/matrix-appservice-bridge/issues/269))
- Replace usages of deprecated `event.user_id` field with `event.sender` in examples. ([\#272](https://github.com/matrix-org/matrix-appservice-bridge/issues/272))


Internal Changes
----------------

- Remove travis-ci build status badge on README.md. ([\#273](https://github.com/matrix-org/matrix-appservice-bridge/issues/273))


2.3.0 (2020-10-26)
===================

No significant changes.


2.3.0-rc3 (2020-10-22)
=======================

Bugfixes
--------

- Fix issue where Intent.join would return undefined rather than the roomId ([\#257](https://github.com/matrix-org/matrix-appservice-bridge/issues/257))


2.3.0-rc2 (2020-10-22)
=======================

Bugfixes
--------

- Fix a bug where a timeout would not be cleared after a sucessful homeserver ping test ([\#256](https://github.com/matrix-org/matrix-appservice-bridge/issues/256))


2.3.0-rc1 (2020-10-21)
=======================

Features
--------

- Add `MembershipQueue` component ([\#251](https://github.com/matrix-org/matrix-appservice-bridge/issues/251))
- Add function to ping the homeserver to check that the AS can be reached ([\#253](https://github.com/matrix-org/matrix-appservice-bridge/issues/253))
- Add `uploadContent()`, and `setRoomDirectoryVisibility()` intent functions ([\#254](https://github.com/matrix-org/matrix-appservice-bridge/issues/254))


Bugfixes
--------

- Fix a bug where the default configuration would be overwritten on validation ([\#252](https://github.com/matrix-org/matrix-appservice-bridge/issues/252))
- Fix a bug where messages would be echoed to the bridge from the bot user, even if `suppressEcho` was on. ([\#255](https://github.com/matrix-org/matrix-appservice-bridge/issues/255))


2.2.0 (2020-10-15)
===================

No significant changes.


2.2.0-rc2 (2020-10-13)
=======================

Features
--------

- Add a function to intent to set the user's profile in a room. ([\#248](https://github.com/matrix-org/matrix-appservice-bridge/issues/248))


Bugfixes
--------

- Don't join the room when doing a self-kick ([\#250](https://github.com/matrix-org/matrix-appservice-bridge/issues/250))


2.2.0-rc1 (2020-10-12)
===================

Features
--------

- Update matrix-js-sdk to v8.4.1 ([\#237](https://github.com/matrix-org/matrix-appservice-bridge/issues/237))
- Add support for ephemeral events from the AS api (MSC2409) ([\#238](https://github.com/matrix-org/matrix-appservice-bridge/issues/238))
- Return the roomId when calling intent.join ([\#241](https://github.com/matrix-org/matrix-appservice-bridge/issues/241))


Bugfixes
--------

- Fix bug where OnAliasQuery would fail to fire if OnUserQuery was not defined ([\#247](https://github.com/matrix-org/matrix-appservice-bridge/issues/247))
- Fix issue where ghost users would not be registered if they've never used the bridge ([\#249](https://github.com/matrix-org/matrix-appservice-bridge/issues/249))


Internal Changes
----------------

- Return `event_id` when sending a event or state event ([\#242](https://github.com/matrix-org/matrix-appservice-bridge/issues/242))


2.1.0 (2020-09-28)
===================

Bugfixes
--------

- WeakEvent should allow for an optional `state_key` and `unsigned` fields. ([\#236](https://github.com/matrix-org/matrix-appservice-bridge/issues/236))


2.1.0-rc2 (2020-09-25)
=======================

Bugfixes
--------

- Ensure that the bridge bot uses the real homeserver URL when encryption is enabled ([\#233](https://github.com/matrix-org/matrix-appservice-bridge/issues/233))


2.1.0-rc1 (2020-09-23)
=======================

Features
--------

- Add support for bridging encrypted events via [matrix-org/pantalaimon](https://github.com/matrix-org/pantalaimon). ([\#231](https://github.com/matrix-org/matrix-appservice-bridge/issues/231))


2.0.0 (2020-09-21)
===================

**Breaking changes since 1.0**:

- Remove Bluebird Promise support. Promises returned by the library will now be native. ([\#216](https://github.com/matrix-org/matrix-appservice-bridge/issues/216))

Bugfixes
--------

- Reinstate ability to call getProfileInfo without specifying a profile key. ([\#232](https://github.com/matrix-org/matrix-appservice-bridge/issues/232))


2.0.0-rc1 (2020-09-14)
=======================

Features
--------

- Bump matrix-js-sdk to 8.0.1 ([\#194](https://github.com/matrix-org/matrix-appservice-bridge/issues/194))
- Use Typedoc over JSDoc for hosted documentation ([\#199](https://github.com/matrix-org/matrix-appservice-bridge/issues/199))
- The bridge can now optionally reload the config file on a `SIGHUP` signal. Developers should define the `onConfigChanged` callback
  when constructing `Cli` to make use of this feature. ([\#207](https://github.com/matrix-org/matrix-appservice-bridge/issues/207))
- **Breaking**: Remove Bluebird Promise support. Promises returned by the library will now be native. ([\#216](https://github.com/matrix-org/matrix-appservice-bridge/issues/216))
- Make url parameter optional when generating registration. ([\#217](https://github.com/matrix-org/matrix-appservice-bridge/issues/217))
- Add `Bridge.close` method to close the appservice ([\#227](https://github.com/matrix-org/matrix-appservice-bridge/issues/227))


Bugfixes
--------

- Refactor RoomLinkValidator to not hastily approve a link if one user is exempt ([\#184](https://github.com/matrix-org/matrix-appservice-bridge/issues/184))
- Fix bluebird defer warnings by using our own defer implementation. ([\#188](https://github.com/matrix-org/matrix-appservice-bridge/issues/188))
- Bridge.run() now throws if it fails to listen to a port instead of creating a floating promise ([\#191](https://github.com/matrix-org/matrix-appservice-bridge/issues/191))
- Fixed some broken typings and defer failures ([\#200](https://github.com/matrix-org/matrix-appservice-bridge/issues/200))
- Fix issue where providing a custom Registry to getPrometheusMetrics would cause /metrics to emit no response ([\#201](https://github.com/matrix-org/matrix-appservice-bridge/issues/201))


Internal Changes
----------------

- Convert intent.js to TypeScript ([\#185](https://github.com/matrix-org/matrix-appservice-bridge/issues/185))
- Convert `ClientFactory` to Typescript ([\#186](https://github.com/matrix-org/matrix-appservice-bridge/issues/186))
- Linter warnings no longer fail the linter, and `no-explicit-any` is a warning. ([\#187](https://github.com/matrix-org/matrix-appservice-bridge/issues/187))
- Port RequestFactory and Request to Typescript ([\#189](https://github.com/matrix-org/matrix-appservice-bridge/issues/189))
- Remove some bluebird imports and use async/await in some tests ([\#190](https://github.com/matrix-org/matrix-appservice-bridge/issues/190))
- Convert Cli to Typescript ([\#195](https://github.com/matrix-org/matrix-appservice-bridge/issues/195))
- Remove `request` dependency ([\#197](https://github.com/matrix-org/matrix-appservice-bridge/issues/197))
- Typescriptify models/* ([\#202](https://github.com/matrix-org/matrix-appservice-bridge/issues/202))
- Typescriptify MembershipCache ([\#203](https://github.com/matrix-org/matrix-appservice-bridge/issues/203))
- Typescriptify ClientRequestCache ([\#204](https://github.com/matrix-org/matrix-appservice-bridge/issues/204))
- Port Logging to Typescript. This change makes `winston`, `winston-daily-rotate-file` and `chalk` a required dependency. ([\#205](https://github.com/matrix-org/matrix-appservice-bridge/issues/205))
- Typescriptify ConfigValidator ([\#206](https://github.com/matrix-org/matrix-appservice-bridge/issues/206))
- **Breaking**: Typescriptify the room, user and event stores. The stores will now return pure Promises (not Bluebird), which means code that relys on Bluebird features will **break**. ([\#208](https://github.com/matrix-org/matrix-appservice-bridge/issues/208))
- Port RoomUpgradeHandler to Typescript ([\#209](https://github.com/matrix-org/matrix-appservice-bridge/issues/209))
- Typescriptify BridgeContext ([\#210](https://github.com/matrix-org/matrix-appservice-bridge/issues/210))
- Typescriptify bridge errors. The `wrap` function has been renamed to `wrapError`. ([\#211](https://github.com/matrix-org/matrix-appservice-bridge/issues/211))
- Typescriptify AppserviceBot ([\#212](https://github.com/matrix-org/matrix-appservice-bridge/issues/212))
- Port the `Bridge` object to Typescript and remove javascript linting ([\#213](https://github.com/matrix-org/matrix-appservice-bridge/issues/213))
- Implement tweaks to typings to support existing bridges ([\#218](https://github.com/matrix-org/matrix-appservice-bridge/issues/218))
- Upgrade internal tooling to use TypeScript 4 ([\#219](https://github.com/matrix-org/matrix-appservice-bridge/issues/219))
- Types: Make some options of Cli optional
  Small corrections to HOWTO.md ([\#224](https://github.com/matrix-org/matrix-appservice-bridge/issues/224))
- Types: Make some options of Bridge optional
  Add a project example: slack-starter ([\#225](https://github.com/matrix-org/matrix-appservice-bridge/issues/225))
- Upgrade dependency: matrix-appservice ([\#226](https://github.com/matrix-org/matrix-appservice-bridge/issues/226))


1.13.2 (2020-07-24)
====================

Bugfixes
--------

- Fix usages of private properties on `AppserviceRegistration` ([\#179](https://github.com/matrix-org/matrix-appservice-bridge/issues/179))


Internal Changes
----------------

- Update packages to latest versions ([\#175](https://github.com/matrix-org/matrix-appservice-bridge/issues/175))
- Remove travis-ci configuration file ([\#176](https://github.com/matrix-org/matrix-appservice-bridge/issues/176))
- Port `EventQueue` to Typescript. ([\#177](https://github.com/matrix-org/matrix-appservice-bridge/issues/177))
- Run NPM `build` on `prepublish`. ([\#178](https://github.com/matrix-org/matrix-appservice-bridge/issues/178))


1.13.1 (2020-06-26)
====================

Bugfixes
--------

- Drain log messages after configuring logging, not just on first message. Thanks @halkeye! ([\#150](https://github.com/matrix-org/matrix-appservice-bridge/issues/150))
- Fix bug where `ContentRepo` is undefined due to `matrix-js-sdk` export changes. ([\#171](https://github.com/matrix-org/matrix-appservice-bridge/issues/171))


1.13.0 (2020-06-25)
==============================

Features
--------

- Make parsed CLI arguments accessible to bridges. Thanks @devec0! ([\#164](https://github.com/matrix-org/matrix-appservice-bridge/issues/164))
- Use `towncrier` for changelog tracking ([\#168](https://github.com/matrix-org/matrix-appservice-bridge/issues/168))
- Allow bridges to provide their own prometheus metrics Register
  and disable the default metrics endpoint ([\#169](https://github.com/matrix-org/matrix-appservice-bridge/issues/169))


Bugfixes
--------

- Fix prototype bug ([\#170](https://github.com/matrix-org/matrix-appservice-bridge/issues/170))


1.12.2 (2020-04-17)
==================

### Changes

* Fix a bug where Authorization headers were ignored for authenticated requests #162

1.12.1 (2020-04-16)
==================

### Changes

* Fix an error which would break all custom bridge endpoints #161

1.12.0 (2020-04-16)
==================

### Changes

* Remove usage of v1 event format keys in the library. #145
* The project now supports Typescript source files. #148
* StateLookup /state requests are now queued rather than run in parallel. #157
* **IMPORTANT** The bridge now supports authenticating `/_matrix/app/.../thirdparty` requests. #158
  To remain backwards compatible with other homeservers, it is off by default. Setting
  `opts.authenticateThirdpartyEndpoints` to `true` on the `Bridge` object will enable this behaviour.
* Limit thirdparty requests to `v1` and `unstable` versions. #160

### Docs

* Update `HOWTO.md` to clarify `server_name`/`localhost` confusion. Thanks @marceltransier! #141
* Remove /appservice URL parth from `cli.js` help text. #152

### Misc

* Minimum required Node.JS version is now 10. Thanks @V02460 #146
* Audit packages and update versions. #159

1.11.1 (2019-11-01)
==================

### Changes

* Use `matrix-appservice` `0.4.1` #138
* Bridges can now bind to a hostname rather than listening globally #137

1.11.0 (2019-10-23)
==================

### Changes

* Add option to disable stores #135

1.10.3 (2019-09-11)
==================

### Changes

- Ensure getJoinedMembers uses the roomId parameter

1.10.2 (2019-09-10)
==================

### Changes

- Ensure getJoinedMembers returns it's promise

1.10.1 (2019-09-10)
==================

### Changes

* Update matrix-js-sdk to 2.3.0 #134
* Fix issue where rejected promises would not be returned from _onEvent #133 #132

1.10.0 (2019-08-22)
==================

### Changes

* Bridge Errors are a new unstable feature which allows a bridge to report errors
  to the client when a message cannot be relayed. This feature is not stable and
  will be subject to change in the future. Please read the README for more
  information. #111, #121, #125, #127. Thanks to Kai (@V02460) for their work on this
  during GSOC!

* Remove old room store entries during upgrade. #129, #130

1.9.2 (2019-08-05)
==================

### Changes

* Bugfix where we failed to handle events with empty string `state_key`s

1.9.1 (2019-08-05)
==================

### Changes

* **Security fix** Check that `state_key` exists on tombstone events.

1.9.0 (2019-07-05)
==================

### Changes

* New `EventStore` component for storing matrix and remote event id mappings. #107
* Request.outcomeFrom no longer expects a Bluebird promise. #104
* Username escaping now handles `[ ]` #112
* Escaping can be now disabled by changing `MatrixUser.ESCAPE_DEFAULT` to `false`. #112

### Misc

* Linting has been fixed, and now supports more modern syntax. #110

1.8.1 (2019-04-17)
==================

### Changes

* Fix issue where not supplying RoomUpgradeHandler would break incoming events
* Handle more cases of userid encoding

1.8.0 (2019-03-15)
==================

### Changes

New `RoomUpgradeHandler` component to handle room upgrades. More information on this can be found in the README.md.

* Fixed bug where the cli interface would incorrectly output to the log rather than to the console
* Fixed bug where invites and bans would be used to determine if a user "exists", which is not reliable.
* Bump matrix-js-sdk to 1.0.1

1.7.0 (2018-10-05)
==================

### ** Breaking change**
MatrixUser now escapes user ids by default which means any user id not conforming to https://matrix.org/docs/spec/appendices.html#user-identifiers
will have some characters converted to [QP encoding](https://en.wikipedia.org/wiki/Quoted-printable).
This is likely to break some store mappings as well as create escaped ghost users
where previously invalid ids would have been accepted.

### Changes

User ids are now escaped when using `MatrixUser`, see above.

Packages `js-yaml`, `matrix-appservice`, `istanbul` have been updated.
`jayschema` was removed in favour of `is-my-json-valid`.

New component `RoomLinkValidator` can now parse rule files for linking rooms
  and abort a link that could potentially be problematic.

New component `Logging` is a simple wrapper around `winston` (which falls back
  to console) for more straight forward log management.

See the README and docs for more information about these components.

1.6.1 (2018-08-30)
==================

Fix bug where age counters would overwrite it's parameter for periods.

1.6.0 (2018-08-23)
==================

Some `Intent` operations now cache requests that would otherwise fall through
to the homeserver which can be expensive. This is configurable for `Intent`s
via the `opts.caching.ttl` and `size` options.

AgeCounters now allow you to set your own time period buckets.

Added a new function `Intent.getEvent` which will fetch events
from the homeserver without any context information, which should
be quick.

`MembershipCache` is now exposed to let folks read and write to the cache
while also letting the bridge access it.

`a` release: Fix issue where `roomState` would fail.
`b` release: Fix issue where we were calling this.intent *inside* intent like fools!
`c` release: Fix issue where some stole js-sdk code was not checked thoroughly.

1.5.0 (2018-07-25)
==================

Updated matrix-js-sdk and matrix-appservice-node to latest versions.

The bridge now depends on prom-client.

When `_ensureRegistered` fails, we now reject the `Promise` with the error
unless the user is in use (`M_USER_IN_USE`). This means that most intent
functions will reject if the user fails to be registered. This may break your
bridge, so please be aware of it.

Created and exposed the membership cache through `MembershipCache` so
bridge developers may optionally setup the bridge any previous state they
may be aware of.

Membership is automatically passed to the `MembershipCache` when `getJoinedMembers`
is called so that we don't needlessly join rooms. Registration is also cached now
so that we do not try to register users we are aware of through membership.

Deprecated `getMemberLists` as it relied on /sync which is no longer allowed
in the client-server API for appservices. This will now throw an `Error` instead.

Exposed `isRemoteUser` (`_isRemoteUser` is still present for backwards compat).

New `setPresence` function on Intent for setting presence, can now disable presence
on the bridge via the bridge config.

Enable the default process-wide metrics in prom-client

`a` release: Fixes enablePresence being off by default

1.4.0 (2017-05-08)
==================

Added `dontJoin` option to `Intent` class for use when the bridge is maintaining
its own membership state for each user.

Share data structures created by `Intent` objects when accessed via the `Bridge`
class. This reduces memory usage and CPU usage as only 1 map needs to be updated
when new member/power level events are received, rather than N maps (where N is
the number of `Intent` objects).

Cull `Intent` objects which are accessed via `Bridge.getIntent` after an eviction
period. This reduces memory usage.

`a` release: Bugfixes whereby the bot `Intent` could forget its state.

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
