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

import { Datastore, RemoveOptions, UpdateOptions } from "./bridge-store";

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

    public async insert(newDocs: Doc[]): Promise<Doc[]> {
        const inserted = newDocs.map(doc => ({ ...doc }));
        this.docs.push(...inserted);
        return inserted;
    }

    public async update(query: Query, updateQuery: Query, options?: UpdateOptions): Promise<number> {
        const matched = this.docs.filter(doc => matchesQuery(doc, query));
        const toUpdate = options?.multi ? matched : matched.slice(0, 1);
        if (toUpdate.length === 0 && options?.upsert) {
            this.docs.push({ ...updateQuery });
            return 1;
        }
        toUpdate.forEach(doc => {
            this.docs[this.docs.indexOf(doc)] = { ...updateQuery };
        });
        return toUpdate.length;
    }

    public async remove(query: Query, options: RemoveOptions): Promise<number> {
        const matched = this.docs.filter(doc => matchesQuery(doc, query));
        const toRemove = options?.multi ? matched : matched.slice(0, 1);
        this.docs = this.docs.filter(doc => !toRemove.includes(doc));
        return toRemove.length;
    }

    public async findOne(query: Query): Promise<Doc | null> {
        const found = this.docs.find(doc => matchesQuery(doc, query));
        return found ? { ...found } : null;
    }

    public async find(query: Query): Promise<Doc[]> {
        return this.docs.filter(doc => matchesQuery(doc, query)).map(doc => ({ ...doc }));
    }

    public async ensureIndex(): Promise<void> {
        // Uniqueness/sparseness is not enforced by this in-memory store.
    }
}
