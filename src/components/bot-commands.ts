import "reflect-metadata";
import Markdown from "markdown-it";
import stringArgv from "string-argv";
import { TextualMessageEventContent } from "matrix-bot-sdk";

const md = new Markdown();

interface BotCommandEntry<R> {
    fn: BotCommandFunction<R>;
    requiredArgs: string[];
    optionalArgs?: string[];
}

interface BotCommandMetadata {
    help: string;
    name: string;
    requiredArgs: string[],
    optionalArgs?: string[],
}

const botCommandSymbol = Symbol("botCommandMetadata");

/**
 * Expose a function as a command. The arugments of the function *must* take a single
 * `CommandArguments` parameter.
 * @param options Metadata about the command.
 */
export function BotCommand(options: BotCommandMetadata): void {
    Reflect.metadata(botCommandSymbol, options);
}
export interface CommandArguments<R> {
    request: R;
    /**
     * Arguments supplied to the function, in the order of requiredArgs, optionalArgs.
     */
    args: string[];
}
export type BotCommandFunction<R> = (args: CommandArguments<R>) => Promise<void>;

/**
 * Error to be thrown by commands that could not complete a request.
 */
export class BotCommandError extends Error {
    /**
     * Construct a `BotCommandError` instance.
     * @param error The inner error
     * @param humanText The error to be shown to the user.
     */
    constructor(error: Error|string, public readonly humanText: string) {
        super(typeof error === "string" ? error : error.message);
        if (typeof error !== "string") {
            this.stack = error.stack;
        }
    }
}

export class BotCommandHandler<T, R extends Record<string, unknown>> {
    /**
     * The body of a Matrix message to be sent to users when they ask for help.
     */
    public readonly helpMessage: TextualMessageEventContent;
    private readonly botCommands: {[name: string]: BotCommandEntry<R>};

    /**
     * Construct a new command helper.
     * @param prototype The prototype of the class to bind to for bot commands.
     *                  It should contain at least one `BotCommand`.
     * @param instance The instance of the above prototype to bind to for function calls.
     * @param prefix A prefix to be stripped from commands (useful if using multiple handlers). The prefix
     * should **include** any whitspace E.g. `!irc `.
     */
    constructor(
        prototype: Record<string, BotCommandFunction<R>>,
        instance: T,
        private readonly prefix?: string) {
        let content = "Commands:\n";
        const botCommands: {[prefix: string]: BotCommandEntry<R>} = {};
        Object.getOwnPropertyNames(prototype).forEach(propetyKey => {
            const b = Reflect.getMetadata(botCommandSymbol, prototype, propetyKey) as BotCommandMetadata;
            if (!b) {
                // Not a bot command function.
                return;
            }
            const requiredArgs = b.requiredArgs.join(" ");
            const optionalArgs = b.optionalArgs?.map((arg: string) => `[${arg}]`).join(" ") || "";
            content += ` - \`${this.prefix || ""}${b.name}\` ${requiredArgs} ${optionalArgs} - ${b.help}\n`;
            // We know that this is safe.
            botCommands[b.name as string] = {
                fn: prototype[propetyKey].bind(instance),
                requiredArgs: b.requiredArgs,
                optionalArgs: b.optionalArgs,
            };
        });
        if (Object.keys(botCommands).length === 0) {
            throw Error('Prototype did not have any bot commands bound');
        }
        this.helpMessage = {
            msgtype: "m.notice",
            body: content,
            formatted_body: md.render(content),
            format: "org.matrix.custom.html"
        };
        this.botCommands = botCommands;
    }

    /**
     * Process a command given by a user.
     * @param userCommand The command string given by the user in it's entireity. Should be plain text.
     * @throws With a `BotCommandError` if the command didn't contain enough arugments. Any errors thrown
     *         from the handler function will be passed through.
     * @returns `true` if the command was handled by this handler instance.
     */
    public async handleCommand(
        userCommand: string, request: R,
    ): Promise<boolean> {

        // The processor may require a prefix (like `!github `). Check for it
        // and strip away if found.
        if (this.prefix) {
            if (!userCommand.startsWith(this.prefix)) {
                return false;
            }
            userCommand = userCommand.substring(this.prefix.length);
        }

        const parts = stringArgv(userCommand);

        // This loop is a little complex:
        // We want to find the most likely candiate for handling this command
        // which we do so by joining together the whole command string and
        // matching against any commands with the same name.
        // If we can't find any, we strip away the last arg and try again.
        // E.g. In the case of `add one + two`, we would search for:
        // - `add one + two`
        // - `add one +`
        // - `add one`
        // - `add`
        // We iterate backwards so that command trees can be respected.
        for (let i = parts.length; i > 0; i--) {
            const cmdPrefix = parts.slice(0, i).join(" ").toLowerCase();
            const command = this.botCommands[cmdPrefix];
            if (!command) {
                continue;
            }
            // We have a match!
            if (command.requiredArgs.length > parts.length - i) {
                throw new BotCommandError("Missing arguments", "Missing required arguments for this command");
            }
            await command.fn({
                request,
                args:  parts.slice(i),
            });
            return true;
        }
        return false;
    }
}
