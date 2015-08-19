# Matrix Application Service Bridging Infrastructure
This library sits on top of the
[core application service library](https://github.com/matrix-org/matrix-appservice-node)
and provides an API for setting up bridges quickly.

# Architecture

```
 _____   __________________
|     | |                  |
| IRC | | Your-bridge-here |
|_____| |__________________|
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

# API

A hosted reference can be found on GitHub Pages (TODO).

## A word on terminology

This library can be used to bridge with many different networks. This makes it
hard to identify the "outside network" via a single consistent name for types
and function names. This library refers to the "outside network" as the
`Jungle`: after all, it *is* a jungle out there. This name makes it easier to
intuit what `getJungleId` means, versus the alternative `getBridgedUserId` which
could be confused with Matrix's `user_id`. This also makes it a lot easier to
`grep`!
