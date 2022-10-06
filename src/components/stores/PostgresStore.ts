import postgres from 'postgres';
import { Logger } from "../..";

const log = new Logger("PostgresStore");

// eslint-disable-next-line @typescript-eslint/ban-types
export interface PostgresStoreOpts extends postgres.Options<{}> {
    url?: string;
}

export type SchemaUpdateFunction = (sql: postgres.Sql) => void;

/**
 * A postgres store abstraction for use with a bridge.
 */
export abstract class PostgresStore {
    public static readonly LATEST_SCHEMA = 9;
    private hasEnded = false;
    public readonly sql: postgres.Sql;

    public get latestSchema() {
        return this.schemas.length;
    }

    constructor(private readonly schemas: SchemaUpdateFunction[], opts: PostgresStoreOpts) {
        this.sql = opts.url ? postgres(opts.url, opts) : postgres(opts);
        process.on("beforeExit", () => {
            // Ensure we clean up on exit
            this.destroy().catch(ex => {
                log.warn('Failed to cleanly exit', ex);
            });
        })
    }

    public async ensureSchema(): Promise<void> {
        log.info("Starting database engine");
        let currentVersion = await this.getSchemaVersion();
        // Zero-indexed, so schema 1 would be in slot 0.
        while (this.schemas[currentVersion]) {
            log.info(`Updating schema to v${currentVersion + 1}`);
            const runSchema = this.schemas[currentVersion];
            try {
                await runSchema(this.sql);
                currentVersion++;
                await this.updateSchemaVersion(currentVersion);
            }
            catch (ex) {
                log.warn(`Failed to run schema v${currentVersion + 1}:`, ex);
                throw Error("Failed to update database schema");
            }
        }
        log.info(`Database schema is at version v${currentVersion}`);
    }

    public async destroy() {
        log.info("Destroy called");
        if (this.hasEnded) {
            // No-op if end has already been called.
            return;
        }
        this.hasEnded = true;
        await this.sql.end();
        log.info("PostgresSQL connection ended");
    }

    private async updateSchemaVersion(version: number) {
        log.debug(`updateSchemaVersion: ${version}`);
        await this.sql`UPDATE schema SET version = ${version};`;
    }

    private async getSchemaVersion(): Promise<number> {
        try {
            const result = await this.sql<{version: number}[]>`SELECT version FROM SCHEMA;`;
            return result?.[0]?.version;
        }
        catch (ex) {
            if (ex.code === "42P01") { // undefined_table
                log.warn("Schema table could not be found");
                return 0;
            }
            log.error("Failed to get schema version: %s", ex);
        }
        throw Error("Couldn't fetch schema version");
    }
}
