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

// Usage:
// node index.js -r -u "http://localhost:9000" # remember to add the registration!
// node index.js -p 9000
import { Cli, Bridge, AppServiceRegistration, ClientEncryptionSession, ClientEncryptionStore, Logger} from 'matrix-appservice-bridge';

const log = new Logger("index");

const encMap = new Map<string, ClientEncryptionSession>();
const encryptionStore: ClientEncryptionStore = {
    async getStoredSession(userId: string) {
        return encMap.get(userId) || null;
    },
    async setStoredSession(session: ClientEncryptionSession) {
        log.info("Set session", session.userId, session.deviceId);
        encMap.set(session.userId, session);
    },
    async updateSyncToken() {
        // No-op
    },
};

new Cli({
    registrationPath: "enc-registration.yaml",
    generateRegistration: function (reg, callback) {
        reg.setId(AppServiceRegistration.generateToken());
        reg.setHomeserverToken(AppServiceRegistration.generateToken());
        reg.setAppServiceToken(AppServiceRegistration.generateToken());
        reg.setSenderLocalpart("encbot");
        reg.addRegexPattern("users", "@enc_.*", true);
        callback(reg);
    },
    run: function (port, _config, registration) {
        let bridge: Bridge;
        bridge = new Bridge({
            homeserverUrl: "http://localhost:8008",
            domain: process.env.MATRIX_DOMAIN,
            registration: "enc-registration.yaml",
            bridgeEncryption: {
                homeserverUrl: "http://localhost:8004",
                store: encryptionStore,
            },
            controller: {
                onUserQuery: function () {
                    return {}; // auto-provision users with no additonal data
                },

                onEvent: async function (request, context) {
                    const event = request.getData();
                    const bot = bridge.getBot();
                    const intent = bridge.getIntentFromLocalpart(`enc_${context.senders.matrix.localpart}`);
                    console.log(request, bot.getUserId());
                    if (event.type === "m.room.member" &&
                        event.content.membership === "invite" &&
                        event.state_key === bot.getUserId()) {
                            console.log("Joining the room!");
                            try {
                                await intent.join(event.room_id);
                                console.log("Joined the room!");
                            }
                            catch (ex) {
                                console.log("Err joining room:", ex);
                            }
                        return;
                    }

                    if (event.type === "m.room.encrypted") {
                        await intent.sendText(event.room_id, "Not encrypted!");
                        return;
                    }

                    if (event.type !== "m.room.message" || !event.content) {
                        return;
                    }

                    await intent.sendText(event.room_id, event.content.body as string);
                }
            }
        });
        const splitUrl = registration.getAppServiceUrl().split(":");
        const urlPort = parseInt(splitUrl[splitUrl.length-1]);
        port = port || urlPort || 8000;
        bridge.run(port);
        log.info(`Matrix-side listening on port ${port}`);
    }
}).run();
