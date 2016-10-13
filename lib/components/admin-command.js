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

    if (opts.options) {
        this.optspec = Object.create(null);
        this.optaliases = Object.create(null);

        Object.keys(opts.options).forEach((k) => {
            var names = k.split(/\|/);

            var result = names.shift().match(/^(!?)(.*?)$/);
            var name = result[2];
            var required = result[1];

            this.optspec[name] = {
                desc: opts.options[k],
                required: required,
            }

            names.forEach((a) => this.optaliases[a] = name);
        });
    }
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
    var opts;
    if (this.optspec) {
        opts = minimist(args);

        // minimist puts left-over positional arguments in a list in "_".
        args = opts._;
        delete opts["_"];

        // Canonicalise aliases
        Object.keys(this.optaliases).forEach((a) => {
            if (a in opts) {
                opts[this.optaliases[a]] = opts[a];
                delete opts[a];
            }
        });

        Object.keys(opts).forEach((n) => {
            if (!(n in this.optspec)) {
                throw Error("Unrecognised option: " + n);
            }
        });

        var missing = [];
        Object.keys(this.optspec).sort().forEach((n) => {
            if (this.optspec[n].required && !(n in opts)) {
                missing.push(n);
            }
        });

        if (missing.length) {
            throw Error("Missing required options: " + missing.join(", "));
        }
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
                var optspec = cmd.optspec || {};
                Object.keys(optspec).sort().forEach((n) => {
                    respond("  --" + n + ": " + optspec[n].desc);
                });
            }
        },
    });
};

/**
 * A specification of command-line options recognised by an AdminCommand.
 * @typedef {Object} AdminCommand~options
 * Each option is given as a key to this object whose key name is the name
 * of the option, and the value is a string giving some descriptive text for
 * the 'help' command.
 * Each option name may be suffixed by aliases (for example, single letter
 * short forms) separated by pipe symbols ('|'). Users may enter options in
 * any of these shortcuts; the value presented to the command handler function
 * will come in a key named after the first name component.
 * Each option may be declared as mandatory, by prefixing the name string with
 * an exclamation point ('!'). It then becomes an error to try to invoke the
 * command without providing a value for that option; effectively turning it
 * into a named argument instead.
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
