/* eslint-disable @typescript-eslint/no-explicit-any */
/*
Copyright 2020 The Matrix.org Foundation C.I.C.

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

type Query = Record<string, unknown>;

/**
 * A minimal document store interface. Any datastore implementing this shape
 * can be used to back a {@link BridgeStore}.
 */
export interface Datastore {
    insert(newDocs: any[]): Promise<any[]>;
    update(query: any, updateQuery: any, options?: UpdateOptions): Promise<number>;
    remove(query: any, options: RemoveOptions): Promise<number>;
    findOne(query: any): Promise<any>;
    find(query: any): Promise<any[]>;
    ensureIndex(options: EnsureIndexOptions): Promise<void>;
}

export interface UpdateOptions {
    multi?: boolean;
    upsert?: boolean;
}
export interface RemoveOptions {
    multi?: boolean;
}
export interface EnsureIndexOptions {
    fieldName: string;
    unique?: boolean;
    sparse?: boolean;
}

/**
 * Base class for bridge stores.
 */
export class BridgeStore {
    constructor (public readonly db: Datastore) { }

    /**
     * INSERT a multiple documents.
     */
    public insert(objects: unknown) {
        return this.db.insert([objects]);
    }

    /**
     * UPSERT a single document
     */
    public upsert<T>(query: Query, updateVals: T) {
        return this.db.update(query, updateVals, {upsert: true});
    }

    /**
     * INSERT IF NOT EXISTS a single document
     */
    public async insertIfNotExists(query: Query, insertObj: Record<string, unknown>) {
        const item = await this.selectOne(query);
        if (!item) {
            this.insert(insertObj);
        }
    }

    /**
     * UPDATE a single document. If the document already exists, this will NOT update
     * it.
     */
    public update(query: Query, updateVals: Record<string, unknown>) {
        return this.db.update(query, updateVals, {upsert: false});
    }

    /**
     * DELETE multiple documents.
     */
    public delete(query: Query) {
        return this.db.remove(query, {multi: true});
    }

    /**
     * SELECT a single document.
     */
    public async selectOne<T, O>(query: Query, transformFn?: (input: T) => O): Promise<O|null> {
        const doc = await this.db.findOne(query);
        if (!doc) {
            return null;
        }
        if (transformFn) {
            return transformFn(doc);
        }
        return doc as O;
    }

    /**
     * SELECT a number of documents.
     * @param query
     * @param transformFn
     * @param defer
     */
    public async select<T, O>(query: Query, transformFn?: (input: T) => O) {
        const doc = await this.db.find(query);
        if (!doc) {
            return [];
        }
        if (transformFn) {
            if (Array.isArray(doc)) {
                return doc.map(transformFn);
            }
            return [transformFn(doc)];
        }
        return doc as O[];
    }

    /**
     * Set a UNIQUE key constraint on the given field.
     * @param fieldName The field name. Use dot notation for nested objects.
     * @param sparse Allow sparse entries (undefined won't cause a key
     * violation).
     */
    public setUnique(fieldName: string, sparse = false) {
        return this.db.ensureIndex({
            fieldName: fieldName,
            unique: true,
            sparse: sparse
        });
    }

    /**
     * Convenience method to convert a document to something.
     * @param func The function which will be called with a single document
     * object. Guaranteed not to be null.
     * @return A `transformFn` function to pass to the standard
     * select/delete/upsert/etc methods.
     */
    public convertTo<T, O>(func: (input: T) => O) {
        return function(doc: T) {
            return func(doc);
        }
    }

}
