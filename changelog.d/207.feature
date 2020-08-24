The bridge can now optionally reload the config file on a `SIGHUP` signal. Developers should define the `onConfigChanged` callback
when constructing `Cli` to make use of this feature.