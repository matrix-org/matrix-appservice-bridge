import { LogService } from "matrix-bot-sdk";
import { CustomLogger, Logger } from "../..";


type LoggerReturn = {level: string, msg: string, metadata: unknown};

async function loggerGenerator(): Promise<{level: string, msg: string, metadata: unknown}>{
	return new Promise(res => {
		Logger.configure({ logger: {
			debug: (msg, metadata) => res({level: 'debug', msg, metadata}),
			verbose: (msg, metadata) => res({level: 'verbose', msg, metadata}),
			info: (msg, metadata) => res({level: 'info', msg, metadata}),
			error: (msg, metadata) => res({level: 'error', msg, metadata}),
			warn: (msg, metadata) => res({level: 'warn', msg, metadata}),
		}});
	});
}

describe("Logger", function() {
	beforeEach(() =>{
		// Reset instance before each test.
		Logger.innerLog = undefined;
	});
	it("can be configured with a basic log level", () => {
		Logger.configure({ console: 'info' });
		expect(Logger.innerLog).toBeDefined();
	});
	it("can handle a simple log statement", async () => {
		const logger = loggerGenerator();
		const log = new Logger('FooLog');
		log.info('Hello!');
		expect(await logger).toEqual({level: 'info', msg: 'Hello!', metadata: { module: 'FooLog' }});
	});
	it("can handle a log statement with a requestId", async () => {
		const logger = loggerGenerator();
		const log = new Logger('FooLog', { requestId: '123'});
		log.info('Hello!');
		expect(await logger).toEqual({level: 'info', msg: 'Hello!', metadata: { module: 'FooLog', requestId: '123' }});
	});
	it("redirects noisy bot-sdk messages to debug", async () => {
		for (const messages of [
			{ errcode: 'M_NOT_FOUND', error: 'Room account data not found'},
			{ errcode: 'M_NOT_FOUND', error: 'Event not found.'},
			{ errcode: 'M_USER_IN_USE'},
			{ body: { errcode: 'M_NOT_FOUND', error: 'Room account data not found'}},
			{ body: { errcode: 'M_NOT_FOUND', error: 'Event not found.'}},
			{ body: { errcode: 'M_USER_IN_USE'}},
		]) {
			const logger = loggerGenerator();
			LogService.error('BotModule', messages);
			const { level } = await logger;
			expect(level).toBe('debug');
		}
	});
});