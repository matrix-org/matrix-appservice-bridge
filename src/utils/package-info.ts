import { join, resolve } from "path";
let BridgeVersion: string;

/**
 * Get the current version of the bridge from the package.json file.
 * @param packageJsonPath The path to the package.json of the bridge.
 * @returns Either the version number, or unknown.
 */
export function getBridgeVersion(packageJsonPath = "./package.json"): string {
    packageJsonPath = join(resolve(packageJsonPath));
    if (!BridgeVersion) {
        try {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const nodePackage = require(packageJsonPath);
            BridgeVersion = nodePackage.version;
        }
        catch (err) { BridgeVersion = "unknown" }
    }

    return BridgeVersion;
}

console.log(getBridgeVersion("."));
