import { MatrixClient } from "@vector-im/matrix-bot-sdk";

/**
 * Get the HTTP URL for an MXC URI.
 * @param {string} baseUrl The base homeserver url which has a content repo.
 * @param {string} mxc The mxc:// URI.
 * @param {Number} width The desired width of the thumbnail.
 * @param {Number} height The desired height of the thumbnail.
 * @param resizeMethod The thumbnail resize method to use, either
 * "crop" or "scale".
 * @param allowDirectLinks If true, return any non-mxc URLs
 * directly. Fetching such URLs will leak information about the user to
 * anyone they share a room with. If false, will return the emptry string
 * for such URLs.
 * @return The complete URL to the content. May be empty string if mxc is not a string.
 */
function getHttpUriForMxc(baseUrl: string, mxc: string, width?: number, height?: number,
    resizeMethod?: "crop"|"scale", allowDirectLinks?: boolean): string {
    console.warn("Deprecated call to ContentRepo.getHttpUriForMxc, prefer to use Intent.matrixClient.mxcToHttp");
    if (typeof mxc !== "string" || !mxc) {
        return "";
    }
    if (!mxc.startsWith("mxc://")) {
        return allowDirectLinks ? mxc : "";
    }
    if (width || height || resizeMethod) {
        return new MatrixClient(baseUrl, "").mxcToHttpThumbnail(
            // Types are possibly not defined here, but this matches the previous implementation
            mxc, width as number, height as number, resizeMethod as "crop"|"scale"
        );
    }
    return new MatrixClient(baseUrl, "").mxcToHttp(mxc);
}

export const ContentRepo = {
    getHttpUriForMxc: getHttpUriForMxc,
}
