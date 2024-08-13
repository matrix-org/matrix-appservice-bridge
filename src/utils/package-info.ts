import { join, dirname } from "path";
import { statSync } from "fs";
import pkginfo from "pkginfo";

// This may be defined if the script is run via NPM: https://docs.npmjs.com/cli/v8/using-npm/scripts#packagejson-vars
let BridgeVersion: string|undefined = process.env.npm_package_version;

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
 * Try to determine the path of the `package.json` file for the current
 * running module. Iterates through parent directories of `require.main.filename`
 * until it finds a package.json. This **may** result in false positives.
 * @returns The path to a package.json file, or undefined if one could not be found.
 */
export function identifyPackageFile(): string|undefined {
    // Find the main module path first
    let mainModulePath = require.main?.filename;
    if (!mainModulePath) {
        return undefined;
    }
    do {
        mainModulePath = dirname(mainModulePath);
        try {
            const packagePath = join(mainModulePath, 'package.json');
            statSync(packagePath);
            return packagePath;
        }
        catch (ex) {
            continue;
        }
    } while (mainModulePath !== '/')
    return undefined;
}

/**
 * Get the current version of the bridge from the package.json file.
 * By default this uses `identifyPackageFile` to determine the file.
 * @param packageJsonPath The path to the package.json of the bridge.
 * @returns Either the version number, or unknown.
 */
export function getBridgeVersion(packageJsonPath?: string): string {
    if (BridgeVersion) {
        return BridgeVersion;
    }
    BridgeVersion = require.main && pkginfo.read(
        require.main,
        packageJsonPath && dirname(packageJsonPath)
    )?.package.version || "unknown";

    // Need to be explicit here due to the type of the static BridgeVersion
    return BridgeVersion as string;
}
