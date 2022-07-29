# Platforms

This document outlines the supported platforms for matrix.org bridge projects.

### Bridge versioning

All bridge application and library projects aim to follow the [Semantic Versioning](https://semver.org/) system.

### Node version support

Bridge projects will always support the **Active LTS** release and the **Current** release of Node.JS. When a
Node.JS version falls from Active to Maintenance, we will migrate projects to the next Active release over time.

For users who are on distributions packaging only Maintenance versions of Node.JS, we'd suggest either using Docker
or an alternative Node.JS source.

At time of writing (July 2022) we support 16.X and 18.X as they are the Active and Current releases of Node.JS.

Bridge projects do not support odd-versioned Node.JS releases, as these are short lived non-LTS versions and are
difficult to support since they have a 6 month shelf life.

See https://nodejs.org/en/about/releases/ for more information about Node.JS releases.

### LTS releases

We do not currently have a LTS process for bridge projects. The latest released version of the bridge is
what we aim to support. Versions a few points behind latest might be eligible for some support, but the
advice is always to upgrade as soon as possible.

### Platforms

In terms of installation platforms, we support as a baseline:

  - Installation onto a host directly (via git) on (x86_64) Windows, Mac, Linux.
    - Note, some distros will package ancient versions of Node.JS. For these, we recommend you use
      a solution like [nodesource](https://github.com/nodesource/distributions) or [nvm](https://github.com/nvm-sh/nvm)
  - Docker (x86_64) on Windows, Mac, Linux.

Testing is primarily done on Debian Linux machines, and so should work for distributions based on
or similar to that. Other distributions, platforms and architectures are considered best-effort. 

We do not package our bridges for Linux distributions ourselves, though upstream maintainers
may choose to do so. If you are a maintainer, feel free to reach out to us via the contact medium
listed in the `CONTRIBUTING.md` file for the relevant bridge.
