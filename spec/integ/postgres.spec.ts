import { PostgresStore } from "../../src";
import { getPgDatabase, initPostgres, isPostgresTestingEnabled } from "../helpers/postgres-helper";

/**
 * So we can use the abstraction.
 */
class TestPostgresStore extends PostgresStore {

}

describe('PostgresStore', () => {
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

    afterEach(async () => {
        await store?.destroy();
    })
});
