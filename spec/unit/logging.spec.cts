import { Writable } from "stream";
import { Logger, GlobalLogger } from "../../src/index";

const tortureArgs: [unknown, ...unknown[]][] = [
    ["test-msg"],
    [Number.MAX_VALUE],
    [false],
    [Buffer.from('foo')],
    [new Error('Test')],
    [undefined],
    [null],
    [NaN],
    [[]],
    [() => { /*dummy*/}],
    ["Foo", "test-msg"],
    ["Foo", Number.MAX_VALUE],
    ["Foo", false],
    ["Foo", Buffer.from('foo')],
    ["Foo", new Error('Test')],
    ["Foo", undefined],
    ["Foo", null],
    ["Foo", NaN],
    ["Foo", []],
    ["Foo", () => { /*dummy*/}],
]

const MODULE_NAME = 'LogTesting';

describe('Logger', () => {
    describe('text logger torture test', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let data: any;
        const global = new GlobalLogger();
        global.configureLogging({
            json: false,
            console: 'debug',
        }, new Writable({
            write(chunk, _encoding, callback) {
                data = chunk.toString();
                callback();
            },
        }));

        const log = new Logger(MODULE_NAME, {}, global);
        for (const args of tortureArgs) {
            it(`handles logging '${args.map(t => typeof t).join(', ')}'`, () => {
                for (const level of ['debug', 'info', 'warn', 'error']) {
                    log[level as 'debug'|'info'|'warn'|'error'](args[0], ...args.slice(1));
                    expect(data).toBeDefined();
                    expect(data).toContain(level.toUpperCase());
                    expect(data).toContain(MODULE_NAME);
                }
            })
        }
    });
    describe('JSON logger torture test', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let data: any;
        const global = new GlobalLogger();
        global.configureLogging({
            json: true,
            console: 'debug',
        }, new Writable({
            write(chunk, _encoding, callback) {
                data = JSON.parse(chunk.toString());
                callback();
            },
        }));

        const log = new Logger(MODULE_NAME, {}, global);
        for (const args of tortureArgs) {
            it(`handles logging '${args.map(t => typeof t).join(', ')}'`, () => {
                for (const level of ['debug', 'info', 'warn', 'error']) {
                    log[level as 'debug'|'info'|'warn'|'error'](args[0], ...args.slice(1));
                    expect(data.level).toEqual(level.toUpperCase());
                    expect(data.module).toEqual(MODULE_NAME);
                    expect(data.message).toBeDefined();
                    expect(data.timestamp).toBeDefined();
                    if (args.length > 1) {
                        expect(data.args).toHaveSize(args.length-1);
                    }
                }
            })
        }
    });
});