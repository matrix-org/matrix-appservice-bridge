import "jasmine";
import { ActivityTracker, BotCommand, BotCommandHandler, CommandArguments } from "../../src/index";
import { WhoisInfo, PresenceEventContent, MatrixClient } from "matrix-bot-sdk";


describe("BotCommands", () => {
    it("does not construct without commands", () => {
        expect(() => new BotCommandHandler({}, undefined)).toThrowError('Prototype did not have any bot commands bound');
    });

    it("to process a simple command", async () => {
        let called = false;
        
        class SimpleBotCommander {
            @BotCommand({ help: "Some help", name: "simple-command"})
            public simpleCommand(data: CommandArguments<null>): void {
                called = true;
            }
        }

        const handler = new BotCommandHandler(new SimpleBotCommander());
        await handler.handleCommand("simple-command", null);
        expect(called).toBeTrue();
    });

    it("to process a simple command with augments", async () => {
        let called: any = undefined;
        
        class SimpleBotCommander {
            @BotCommand({ help: "Some help", name: "simple-command", requiredArgs: ["foo", "bar"]})
            public simpleCommand(data: CommandArguments<{some: string}>): void {
                called = data;
            }
        }

        const handler = new BotCommandHandler(new SimpleBotCommander());
        await handler.handleCommand("simple-command abc def", {some: "context"});
        const expectedResult = {
            args: ["abc", "def"],
            request: {
                some: "context",
            }
        }
        expect(called).toEqual(expectedResult);
    });

    it("to process a simple command with optional parameters", async () => {
        let called: any = undefined;
        
        class SimpleBotCommander {
            @BotCommand({ help: "Some help", name: "simple-command", requiredArgs: ["foo", "bar"], optionalArgs: ["baz"]})
            public simpleCommand(data: CommandArguments<{some: string}>): void {
                called = data;
            }
        }

        const handler = new BotCommandHandler(new SimpleBotCommander());
        await handler.handleCommand("simple-command abc def", {some: "context"});
        expect(called).toEqual({
            args: ["abc", "def"],
            request: {
                some: "context",
            }
        });

        await handler.handleCommand("simple-command abc def ghi", {some: "context"});
        expect(called).toEqual({
            args: ["abc", "def", "ghi"],
            request: {
                some: "context",
            }
        });
    });

    it("to process a command and a subcommand", async () => {
        let commandCalled: any = undefined;
        let subCommandCalled: any = undefined;
        
        class SimpleBotCommander {
            @BotCommand({ help: "Some help", name: "simple-command", requiredArgs: ["foo"]})
            public simpleCommand(data: CommandArguments<{some: string}>): void {
                commandCalled = data;
            }
            @BotCommand({ help: "Some help", name: "simple-command with-a-subcommand", requiredArgs: ["foo"]})
            public simpleSubCommand(data: CommandArguments<{some: string}>): void {
                subCommandCalled = data;
            }
        }

        const handler = new BotCommandHandler(new SimpleBotCommander());
        await handler.handleCommand("simple-command abc", undefined);
        expect(commandCalled).toEqual({
            args: ["abc"],
            request: undefined,
        });

        await handler.handleCommand("simple-command with-a-subcommand def", undefined);
        expect(subCommandCalled).toEqual({
            args: ["def"],
            request: undefined,
        });
    });

    it("should produce useful help output", async () => {
        class SimpleBotCommander {
            @BotCommand({ help: "No help at all", name: "very-simple-command"})
            public verySimpleCommand(data: CommandArguments<{some: string}>): void {
            }
            @BotCommand({ help: "Some help", name: "simple-command", requiredArgs: ["requiredArg1"]})
            public simpleCommand(data: CommandArguments<{some: string}>): void {
            }
            @BotCommand({ help: "Even better help", name: "simple-command with-a-subcommand", requiredArgs: ["requiredArg1"], optionalArgs: ["optionalArg1"]})
            public simpleSubCommand(data: CommandArguments<{some: string}>): void {
            }
        }

        const handler = new BotCommandHandler(new SimpleBotCommander());
        expect(handler.helpMessage.format).toEqual("org.matrix.custom.html");
        expect(handler.helpMessage.msgtype).toEqual("m.notice");
        expect(handler.helpMessage.body).toContain("Commands:");
        // Rough formatting match
        expect(handler.helpMessage.body).toContain("- `very-simple-command` - No help at all");
        expect(handler.helpMessage.body).toContain("- `simple-command` requiredArg1 - Some help");
        expect(handler.helpMessage.body).toContain("- `simple-command with-a-subcommand` requiredArg1 [optionalArg1] - Even better help");
    });
});

