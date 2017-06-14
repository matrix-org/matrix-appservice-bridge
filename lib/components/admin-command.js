"use strict";

var minimist = require("minimist");

/**
 * Construct a new AdminCommand helper instance.
 * @constructor
 * @param {Object} opts Options object
 * @param {string} opts.desc A short description to display in the 'help'
 * command.
 * @param {AdminCommand~options=} opts.options An optional object giving
 * commandline option specifications recognised by the command.
 * @param {AdminCommand~func} opts.func The handler function that implements
 * the command.
 */
function AdminCommand(opts) {
    if (!opts.func) throw new Error("Required 'func' parameter missing");

    this.desc = opts.desc;
    this._func = opts.func;

    var optspec    = this.optspec    = {};
    var optaliases = this.optaliases = {};

    if (opts.opts) {
        Object.keys(opts.opts).forEach(function (name) {
            var def = opts.opts[name];

            optspec[name] = {
                desc: def.description,
                required: def.required || false,
                boolean: def.boolean || false,
            }

            if (def.aliases) {
                def.aliases.forEach(function (a) { optaliases[a] = name; });
            }
        });
    }

    if (opts.args) {
        opts.args.forEach(function (name) {
            if (!optspec[name]) {
                throw new Error("AdminCommand does not have an option called '" + name + "'");
            }

            optspec[name].required = true;
        });

        this.argspec = opts.args;
    }

    this.string_args = Object.keys(this.optspec).filter(
        function (n) { return !optspec[n].boolean; });
    this.boolean_args = Object.keys(this.optspec).filter(
        function (n) { return optspec[n].boolean; });
}

/**
 * Invoke the handler function for the command. The given list of strings will
 * be parsed for optional arguments as per the command's options specification
 * if present.
 * @param {Object} bridge The top-level bridge instance to pass to the handler
 * function.
 * @param {string[]} args A list of string arguments parsed from the command
 * line.
 * @param {function} respond The responder function to pass to the handler
 * function.
 * @return {Promise} Returns the void promise returned by the handler function.
 */
AdminCommand.prototype.run = function(bridge, args, respond) {
    var opts = minimist(args, {
        string: this.string_args,
        boolean: this.boolean_args,
    });

    args = opts._;
    delete opts["_"];

    var optspec = this.optspec;
    var optaliases = this.optaliases;

    // Canonicalise aliases
    Object.keys(optaliases).forEach(function (a) {
        if (a in opts) {
            opts[optaliases[a]] = opts[a];
            delete opts[a];
        }
    });

    Object.keys(opts).forEach(function (n) {
        if (n === "_") return;

        if (!(n in optspec)) {
            throw Error("Unrecognised argument: " + n);
        }
    });

    // Parse the positional arguments first so we can complain about any
    // missing ones in order
    if (this.argspec) {
        // In current implementation, every positional argument is required
        var missing = false;

        this.argspec.forEach(function (name) {
            if (opts[name] !== undefined ||
                !args.length) {
                missing = true;
                return;
            }

            opts[name] = args.shift();
        });

        if (missing) {
            throw Error("Required arguments: " + this.argspec.join(" "));
        }
    }

    var missing = [];
    Object.keys(optspec).sort().forEach(function (n) {
        if (optspec[n].required && !(n in opts)) missing.push("--" + n);
    });

    if (missing.length) {
        throw Error("Missing required options: " + missing.join(", "));
    }

    return this._func(bridge, opts, args, respond);
};

/**
 * Helper method to construct a 'help' AdminCommand instance
 * @param {Object} commands The object containing the application's
 * AdminCommand instances.
 * @return {AdminCommand} A new AdminCommand.
 *
 * Typically this method would be invoked just after the admin command object
 * is declared, to provide the automatic online help command.
 *
 * @example
 * var commands = {};
 * commands.help = AdminCommand.makeHelpCommand(commands);
 */
AdminCommand.makeHelpCommand = function(commands) {
    return new AdminCommand({
        desc: "display a list of commands",
        func: function(bridge, _, args, respond) {
            if (args.length == 0) {
                Object.keys(commands).sort().forEach(function (k) {
                    var cmd = commands[k];
                    respond(k + ": " + cmd.desc);
                });
            }
            else {
                var name = args.shift();
                var cmd = commands[name];
                if (!cmd) {
                    throw Error("No such command '" + name + "'");
                }

                respond(name + " - " + cmd.desc);
                var argspec = cmd.argspec || [];
                if(argspec.length) {
                    respond("Arguments: " + argspec.map(function (n) {
                        return "[" + n.toUpperCase() + "]";
                    }).join(" "));
                }
                var optspec = cmd.optspec || {};
                Object.keys(optspec).sort().forEach(function (n) {
                    respond("  --" + n + ": " + optspec[n].desc);
                });
            }
        },
    });
};

/**
 * A specification of command-line options recognised by an AdminCommand.
 * @typedef {Object.<string, AdminCommand~option>} AdminCommand~options
 * Each option is given as a key to this object whose key name is the name
 * of the option, and the value is an object containing its definition.
 */

/**
 * A specification for one option recognised by an AdminCommand.
 * @typedef {Object} AdminCommand~option
 * @param {string} description a string giving some descriptive text for
 * the 'help' command.
 * @param {string[]=} aliases an optional array of strings giving alternative
 * names for the option.
 * @param {boolean=} required an optional boolean which, if true, indicates
 * that this named option is mandatory, and to raise an error if the command is
 * invoked without it.
 * @param {boolean=} boolean an optional boolean which, if true, indicates
 * that this named option takes a simple boolean truth value, not a full
 * string. This affects how it is parsed from the commandline.
 */

/**
 * The handler function for an AdminCommand that contains its actual
 * implementation code.
 * @typedef {function} AdminCommand~func
 * @param {Object} bridge The top-level bridge instance.
 * @param {Object} opts Values of any commandline options the user supplied
 * @param {string[]} args Remaining positional commandline arguments after the
 * options have been parsed out.
 * @param {function} respond The responder function that the command handler
 * can use to report text back to the invoking user.
 * @return {Promise} A Promise of nothing.
 */

module.exports = AdminCommand;
