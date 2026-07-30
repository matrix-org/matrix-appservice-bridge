/*
Copyright 2026 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at
    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import { Datastore, EnsureIndexOptions, RemoveOptions, UpdateOptions } from "./bridge-store";

type Doc = Record<string, unknown>;
type Query = Record<string, unknown>;

function getPath(doc: Doc, path: string): unknown {
    return path.split(".").reduce<unknown>((value, key) => {
        if (value === null || typeof value !== "object") {
            return undefined;
        }
        return (value as Doc)[key];
    }, doc);
}

function matchesQuery(doc: Doc, query: Doc): boolean {
    return Object.entries(query).every(([path, expected]) => {
        const actual = getPath(doc, path);
        if (expected !== null && typeof expected === "object" && !Array.isArray(expected) && "$in" in expected) {
            return (expected.$in as unknown[]).includes(actual);
        }
        return actual === expected;
    });
}

/**
 * A minimal in-memory {@link Datastore} implementation. Suitable for tests,
 * or for bridges which do not need their {@link BridgeStore}s to persist
 * data across restarts.
 */
export class MemoryDatastore implements Datastore {
    private docs: Doc[] = [];

    public insert(newDocs: Doc[], cb?: (err: Error | null, documents: Doc[]) => void): void {
        const inserted = newDocs.map(doc => ({ ...doc }));
        this.docs.push(...inserted);
        process.nextTick(() => cb?.(null, inserted));
    }

    public update(
        query: Query,
        updateQuery: Query,
        options?: UpdateOptions,
        cb?: (err: Error | null, numberOfUpdated: number, upsert: boolean) => void,
    ): void {
        const matched = this.docs.filter(doc => matchesQuery(doc, query));
        const toUpdate = options?.multi ? matched : matched.slice(0, 1);
        if (toUpdate.length === 0 && options?.upsert) {
            this.docs.push({ ...updateQuery });
            process.nextTick(() => cb?.(null, 1, true));
            return;
        }
        toUpdate.forEach(doc => {
            this.docs[this.docs.indexOf(doc)] = { ...updateQuery };
        });
        process.nextTick(() => cb?.(null, toUpdate.length, false));
    }

    public remove(query: Query, options: RemoveOptions, cb?: (err: Error | null, n: number) => void): void {
        const matched = this.docs.filter(doc => matchesQuery(doc, query));
        const toRemove = options?.multi ? matched : matched.slice(0, 1);
        this.docs = this.docs.filter(doc => !toRemove.includes(doc));
        process.nextTick(() => cb?.(null, toRemove.length));
    }

    public findOne(query: Query, cb: (err: Error | null, document: Doc | null) => void): void {
        const found = this.docs.find(doc => matchesQuery(doc, query));
        process.nextTick(() => cb(null, found ? { ...found } : null));
    }

    public find(query: Query, cb: (err: Error | null, documents: Doc[]) => void): void {
        const matched = this.docs.filter(doc => matchesQuery(doc, query)).map(doc => ({ ...doc }));
        process.nextTick(() => cb(null, matched));
    }

    public ensureIndex(options: EnsureIndexOptions, cb?: (err: null) => void): void {
        // Uniqueness/sparseness is not enforced by this in-memory store.
        process.nextTick(() => cb?.(null));
    }
}
