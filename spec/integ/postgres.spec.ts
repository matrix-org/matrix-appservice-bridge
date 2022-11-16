import { PostgresStore } from "../../src";
import { getPgDatabase, initPostgres, isPostgresTestingEnabled } from "../helpers/postgres-helper";


// Only run the tests if we've enabled postgres testing.
const descr = isPostgresTestingEnabled() ? describe : xdescribe;

class TestPostgresStore extends PostgresStore { }

descr('PostgresStore', () => {
    let store: TestPostgresStore|undefined;
    beforeAll(() => {
        initPostgres();
    })

    it('can construct a simple database from schema', async () => {
        store = new TestPostgresStore([], {
            url: await getPgDatabase(),
        });
        await store.ensureSchema();
    });

    it('can run schema upgrades', async () => {
        store = new TestPostgresStore([
            sql => sql.begin(s => [
                s`CREATE TABLE v1_users (mxid TEXT UNIQUE NOT NULL);`,
            ]).then(),
            sql => sql.begin(s => [
                s`CREATE TABLE v2_rooms (mxid TEXT UNIQUE NOT NULL);`,
            ]).then(),
        ], {
            autocreateSchemaTable: true,
            url: await getPgDatabase(),
        });
        await store.ensureSchema();
    });

    afterEach(async () => {
        await store?.destroy();
    })
});
