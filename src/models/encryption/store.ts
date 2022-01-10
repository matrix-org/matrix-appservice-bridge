import { RustSdkAppserviceCryptoStorageProvider } from "matrix-bot-sdk";
import { watchFile, promises as fs } from "fs";

/**
 * The RustSdk Crypto store uses a "sled" DB, which is a flat file KV store
 * operated on by the rust internals. This class provides a way to synchronise
 * that dataset in another place (e.g. a PostgreSQL table).
 */
export class SynchronisedCryptoStore extends RustSdkAppserviceCryptoStorageProvider {

    private timeout: NodeJS.Timeout|null = null;

    constructor(
        baseStoragePath: string,
        onSync: (error: Error|null, data?: Buffer) => Promise<void>,
        debounceMs = 2500
    ) {
        super(baseStoragePath);
        const sync = () => {
            fs.readFile(baseStoragePath, null).then((s) => {
                onSync(null, s);
            }).catch(onSync);
            this.timeout = null;
        };

        watchFile(baseStoragePath, () => {
            if (this.timeout) {
                clearTimeout(this.timeout);
            }
            this.timeout = setTimeout(() => {
                sync();
            }, debounceMs);
        });

        // Save the file before the process closes.
        process.on("beforeExit", () => {
            sync();
        });
    }
}
