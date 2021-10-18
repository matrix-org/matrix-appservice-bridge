import { join, resolve } from "path";
let BridgeVersion: string;

/**
 * Forcibly set the version of the bridge, for use by other components.
 * This will override `getBridgeVersion`s default behaviour of fetching the
 * version from package.json.
 * @param version A version string e.g. `v1.0.0`
 */
export function setBridgeVersion(version: string): void {
    BridgeVersion = version;
}

/**
 * Get the current version of the bridge from the package.json file.
 * @param packageJsonPath The path to the package.json of the bridge.
 * @returns Either the version number, or unknown.
 */
export function getBridgeVersion(packageJsonPath = "./package.json"): string {
    if (BridgeVersion) {
        return BridgeVersion;
    }
    packageJsonPath = join(resolve(packageJsonPath));
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const nodePackage = require(packageJsonPath);
        BridgeVersion = nodePackage.version;
    }
    catch (err)
    {
        BridgeVersion = "unknown"
    }
}

console.log(getBridgeVersion("."));
