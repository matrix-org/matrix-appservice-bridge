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
