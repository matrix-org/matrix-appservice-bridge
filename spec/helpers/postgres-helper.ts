import postgres, { Sql } from 'postgres';

let pgClient: Sql;

export function isPostgresTestingEnabled() {
    return !!process.env.BRIDGE_TEST_PGURL;
}

export function initPostgres() {
    // Setup postgres for the whole process.
    pgClient = postgres(`${process.env.BRIDGE_TEST_PGURL}/postgres`);
    process.on("beforeExit", async () => {
        pgClient.end();
    })
}

export async function getPgDatabase() {
    const pgDb = `${process.env.BRIDGE_TEST_PGDB}_${process.hrtime().join("_")}`;
    await pgClient`CREATE DATABASE ${pgClient(pgDb)}`;
    return `${process.env.BRIDGE_TEST_PGURL}/${pgDb}`;
}