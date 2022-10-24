import { MediaProxy } from "../../src";
import { webcrypto } from 'node:crypto';
import { MatrixClient } from "matrix-bot-sdk";

const signingKey = webcrypto.subtle.generateKey({
    name: 'HMAC',
    hash: 'SHA-512',
}, true, ['sign', 'verify']);
const publicUrl = new URL("http://example-public.url/my-cs-path");

describe("MediaProxy", function() {
    let mediaProxy: MediaProxy;
    beforeEach(async function () {
        mediaProxy = new MediaProxy({
            publicUrl,
            ttl: 60,
            signingKey: await signingKey,
        }, new MatrixClient('https://example.com', 'test_access_token'));
    })

    it('can generate a media url', async () => {
        const url = await mediaProxy.generateMediaUrl('mxc://example.com/some_media');
        expect(url.origin).toEqual(publicUrl.origin);
        expect(url.pathname.startsWith('/my-cs-path/v1/media/download')).toBeTrue();
        const base64Data = url.pathname.slice('/my-cs-path/v1/media/download'.length);
        expect(() => Buffer.from(base64Data, 'base64url')).not.toThrow();
    });

    it('can decode a media url', async () => {
        const url = await mediaProxy.generateMediaUrl('mxc://example.com/some_media');
        const token = url.pathname.slice('/my-cs-path/v1/media/download'.length);
        console.log(token);
        const data = await mediaProxy.verifyMediaToken(token);
        console.log(data);
    });
});