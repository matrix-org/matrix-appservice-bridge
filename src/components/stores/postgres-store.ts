import postgres, { PostgresError, PostgresType } from 'postgres';
import { Logger } from "../..";

const log = new Logger("PostgresStore");

export async function v0Schema(sql: postgres.Sql) {
    await sql.begin(s => [
        s`CREATE TABLE schema (version	INTEGER UNIQUE NOT NULL);`,
        s`INSERT INTO schema VALUES (0);`
    ]);
}

export interface PostgresStoreOpts extends postgres.Options<Record<string, PostgresType<unknown>>> {
    /**
     * URL to reach the database on.
     */
    url?: string;
    /**
     * Should the schema table be automatically created (the v0 schema effectively)
     */
    autocreateSchemaTable?: boolean;
}

export type SchemaUpdateFunction = (sql: postgres.Sql) => void;

/**
 * PostgreSQL datastore abstraction which can be inherited by a specalised bridge class.
 *
 * @example
 * class MyBridgeStore extends PostgresStore {
 *   constructor(myurl) {
 *     super([schemav1, schemav2, schemav3], { url: myurl });
 *   }
 *
 *   async getData() {
 *     return this.sql`SELECT * FROM mytable`
 *   }
 * }
 *
 * // Which can then be used by doing
 * const store = new MyBridgeStore("postgresql://postgres_user:postgres_password@postgres");
 * store.ensureSchema();
 * const data = await store.getData();
 */
export abstract class PostgresStore {
    public static readonly LATEST_SCHEMA = 9;
    private hasEnded = false;
    public readonly sql: postgres.Sql;

    public get latestSchema() {
        return this.schemas.length;
    }

    /**
     * Construct a new store.
     * @param schemas The set of schema functions to apply to a database. The ordering of this array determines the
     *                schema number.
     * @param opts Options to supply to the PostgreSQL client, such as `url`.
     */
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

    /**
     * Ensure the database schema is up to date. If you supplied
     * `autocreateSchemaTable` to `opts` in the constructor, a fresh database
     * will have a `schema` table created for it.
     *
     * @throws If a schema could not be applied cleanly.
     */
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

    /**
     * Clean away any resources used by the database. This is automatically
     * called before the process exits.
     */
    public async destroy(): Promise<void> {
        log.info("Destroy called");
        if (this.hasEnded) {
            // No-op if end has already been called.
            return;
        }
        this.hasEnded = true;
        await this.sql.end();
        log.info("PostgresSQL connection ended");
    }

    /**
     * Update the current schema version.
     * @param version
     */
    protected async updateSchemaVersion(version: number): Promise<void> {
        log.debug(`updateSchemaVersion: ${version}`);
        await this.sql`UPDATE schema SET version = ${version};`;
    }

    /**
     * Get the current schema version.
     * @returns The current schema version, or `-1` if no schema table is found.
     */
    protected async getSchemaVersion(): Promise<number> {
        try {
            const result = await this.sql<{version: number}[]>`SELECT version FROM SCHEMA;`;
            return result?.[0]?.version;
        }
        catch (ex) {
            if (ex instanceof PostgresError && ex.code === "42P01") { // undefined_table
                log.warn("Schema table could not be found");
                return -1;
            }
            log.error("Failed to get schema version: %s", ex);
        }
        throw Error("Couldn't fetch schema version");
    }
}
