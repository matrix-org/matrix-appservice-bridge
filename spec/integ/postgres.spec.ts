import { PostgresStore } from "../../src";
import { getPgDatabase, initPostgres, isPostgresTestingEnabled } from "../helpers/postgres-helper";


// Only run the tests if we've enabled postgres testing.
let descr = isPostgresTestingEnabled() ? describe : xdescribe;

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

    afterEach(async () => {
        await store?.destroy();
    })
});
