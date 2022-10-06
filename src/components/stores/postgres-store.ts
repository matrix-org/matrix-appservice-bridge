import postgres from 'postgres';
import { Logger } from "../..";

const log = new Logger("PostgresStore");

export async function v0Schema(sql: postgres.Sql) {
    await sql.begin(s => [
        s`CREATE TABLE schema (version	INTEGER UNIQUE NOT NULL);`,
        s`INSERT INTO schema VALUES (0);`
    ]);
}

// eslint-disable-next-line @typescript-eslint/ban-types
export interface PostgresStoreOpts extends postgres.Options<{}> {
    url?: string;
    /**
     * Should the schema table be automatically created (the v0 schema effectively)
     */
    autocreateSchemaTable?: boolean;
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

    constructor(private readonly schemas: SchemaUpdateFunction[], private readonly opts: PostgresStoreOpts) {
        opts.autocreateSchemaTable = opts.autocreateSchemaTable ?? true;
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

        if (currentVersion === -1) {
            if (this.opts.autocreateSchemaTable) {
                log.info(`Applying v0 schema (schema table)`);
                await v0Schema(this.sql);
                currentVersion = 0;
            }
        }
        else {
            // We aren't autocreating the schema table, so assume schema 0.
            currentVersion = 0;
        }

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
                return -1;
            }
            log.error("Failed to get schema version: %s", ex);
        }
        throw Error("Couldn't fetch schema version");
    }
}
