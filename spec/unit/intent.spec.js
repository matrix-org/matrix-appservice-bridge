const { default: MatrixError } = require("@half-shot/matrix-bot-sdk/lib/models/MatrixError");
const { Intent } = require("../..");

const matrixError = (errcode, error) => Promise.reject(new MatrixError({errcode, error}));

describe("Intent", function() {
    let intent, botIntent, client, botClient, underlyingClient;
    const userId = "@alice:bar";
    const botUserId = "@bot:user";
    const roomId = "!foo:bar";
    const alreadyRegistered = {
        registered: true
    };

    beforeEach(function() {
        const clientFields = ["joinRoom", "resolveRoom", "inviteUser", "sendStateEvent", "setUserPowerLevel", "getUserId", "sendEvent"];
        underlyingClient = jasmine.createSpyObj("underlyingClient", clientFields);
        botIntent = {
            userId,
            underlyingClient,
        };
        botClient = jasmine.createSpyObj("botClient", clientFields);
        underlyingClient.resolveRoom.and.callFake(async () => roomId);
        botClient.getUserId.and.callFake(async () => botUserId);
        intent = new Intent(botIntent, botClient, alreadyRegistered);
    });

    describe("join", function() {

        it("should /join/$ROOMID if it doesn't know it is already joined",
        function() {
            underlyingClient.joinRoom.and.callFake(async () => roomId);
            return intent.join(roomId).then(function(resultRoomId) {
                expect(underlyingClient.joinRoom).toHaveBeenCalledWith(
                    roomId, undefined,
                );
                expect(resultRoomId).toBe(roomId);
            });
        });
        it("should /join/$ROOMID if it doesn't know it is already joined with via parameters",
        function() {
            const via = ["foo.org", "bar.org"];
            underlyingClient.joinRoom.and.callFake(async () =>{
                return roomId;
            });
            return intent.join(roomId, via).then(function(resultRoomId) {
                expect(underlyingClient.joinRoom).toHaveBeenCalledWith(
                    roomId, via,
                );
                expect(resultRoomId).toBe(roomId);
            });
        });

        it("should no-op if it knows it is already joined", function() {
            intent.onEvent({
                event_id: "test",
                type: "m.room.member",
                state_key: userId,
                room_id: roomId,
                content: {
                    membership: "join"
                }
            });
            return intent.join(roomId).then(function(resultRoomId) {
                expect(resultRoomId).toBe(roomId);
                expect(underlyingClient.joinRoom).not.toHaveBeenCalled();
            });
        });

        it("should fail if the join returned an error other than forbidden",
        function() {
            underlyingClient.joinRoom.and.callFake(() => matrixError(
                "M_YOU_ARE_A_FISH",
                "you're a fish"
            ));
            return intent.join(roomId).catch(function() {
                expect(underlyingClient.joinRoom).toHaveBeenCalled();
            });
        });

        describe("client join failed", function() {

            it("should make the bot invite then the client join", function() {
                underlyingClient.joinRoom.and.callFake(function() {
                    if (botClient.inviteUser.calls.count() === 0) {
                        return matrixError(
                            "M_FORBIDDEN",
                            "Join first"
                        );
                    }
                    return Promise.resolve(roomId);
                });
                botClient.inviteUser.and.callFake(() => Promise.resolve({}));

                return intent.join(roomId).then(function(resultRoomId) {
                    expect(underlyingClient.joinRoom).toHaveBeenCalledWith(
                        roomId, undefined
                    );
                    expect(botClient.inviteUser).toHaveBeenCalledWith(userId, roomId);
                    expect(resultRoomId).toBe(roomId);
                });
            });

            describe("bot invite failed", function() {
                it("should make the bot join then invite then the client join",
                function() {
                    underlyingClient.joinRoom.and.callFake(function() {
                        if (botClient.inviteUser.calls.count() === 0) {
                            return matrixError(
                                "M_FORBIDDEN",
                                "Join first"
                            );
                        }
                        return Promise.resolve({});
                    });
                    botClient.inviteUser.and.callFake(function() {
                        if (botClient.joinRoom.calls.count() === 0) {
                            return matrixError(
                                "M_FORBIDDEN",
                                "Join first"
                            );
                        }
                        return Promise.resolve({});
                    });
                    botClient.joinRoom.and.callFake(() => Promise.resolve({roomId: roomId}));

                    return intent.join(roomId).then(function(resultRoomId) {
                        expect(underlyingClient.joinRoom).toHaveBeenCalledWith(
                            roomId, undefined
                        );
                        expect(botClient.inviteUser).toHaveBeenCalledWith(userId, roomId);
                        expect(botClient.joinRoom).toHaveBeenCalledWith(
                            roomId, undefined
                        );
                        expect(resultRoomId).toBe(roomId);

                    });
                });

                it("should give up if the bot cannot join the room", function() {
                    underlyingClient.joinRoom.and.callFake(() => matrixError(
                        "M_FORBIDDEN",
                        "Join first"
                    ));
                    botClient.inviteUser.and.callFake(() => matrixError(
                        "M_FORBIDDEN",
                        "No invites kthx"
                    ));
                    botClient.joinRoom.and.callFake(() =>  matrixError(
                        "M_FORBIDDEN",
                        "No bots allowed!"
                    ));

                    return intent.join(roomId).catch(function() {
                        expect(underlyingClient.joinRoom).toHaveBeenCalledWith(
                            roomId, undefined
                        );
                        expect(botClient.inviteUser).toHaveBeenCalledWith(userId, roomId);
                        expect(botClient.joinRoom).toHaveBeenCalledWith(
                            roomId, undefined
                        );
                    });
                });
            });
        });
    });

    describe("sending state events", function() {
        let validPowerLevels, invalidPowerLevels;

        beforeEach(() => {
            // not interested in joins, so no-op them.
            intent.onEvent({
                event_id: "test",
                type: "m.room.member",
                state_key: userId,
                room_id: roomId,
                content: {
                    membership: "join"
                }
            });

            const basePowerLevelEvent = {
                content: {
                    "ban": 50,
                    "events": {
                        "m.room.name": 100,
                        "m.room.power_levels": 100
                    },
                    "events_default": 0,
                    "kick": 50,
                    "redact": 50,
                    "state_default": 50,
                    "users": {
                        "@example:localhost": 100
                    },
                    "users_default": 0
                },
                state_key: "",
                room_id: roomId,
                sender: "@example:localhost",
                type: "m.room.power_levels",
                event_id: "test2"
            };
            validPowerLevels = JSON.parse(JSON.stringify(basePowerLevelEvent));
            validPowerLevels.content.users[userId] = 100;
            invalidPowerLevels = basePowerLevelEvent;
        });

        it("should directly send the event if it thinks power levels are ok",
        function() {
            underlyingClient.sendStateEvent.and.returnValue(Promise.resolve("$foo:bar"));

            intent.onEvent(validPowerLevels);
            return intent.setRoomTopic(roomId, "Hello world").then(function() {
                expect(underlyingClient.sendStateEvent).toHaveBeenCalledWith(
                    roomId, "m.room.topic", "", {topic: "Hello world"}
                );
            })
        });

        it("should modify power levels before sending if client is too low",
        async function() {
            underlyingClient.sendStateEvent.and.callFake(function() {
                if (underlyingClient.sendStateEvent.calls.count() > 1) {
                    return Promise.resolve({});
                }
                return matrixError(
                    "M_FORBIDDEN",
                    "Not enough powaaaaaa",
                );
            });
            botClient.setUserPowerLevel.and.returnValue(Promise.resolve({}));
            // give the power to the bot
            invalidPowerLevels.content.users[botUserId] = 100;
            intent.onEvent(invalidPowerLevels);

            await intent.setRoomTopic(roomId, "Hello world");
            expect(underlyingClient.sendStateEvent).toHaveBeenCalledWith(
                roomId, "m.room.topic", "", {topic: "Hello world"}
            );
            expect(botClient.setUserPowerLevel).toHaveBeenCalledWith(
                userId, roomId, 50
            );
        });

        it("should fail if the bot cannot modify power levels and the client is too low",
        function() {
            // bot has NO power
            intent.onEvent(invalidPowerLevels);

            return intent.setRoomTopic(roomId, "Hello world").catch(function() {
                expect(underlyingClient.sendStateEvent).not.toHaveBeenCalled();
                expect(botClient.setUserPowerLevel).not.toHaveBeenCalled();
            })
        });
    });

    describe("sending message events", function() {
        const content = {
            body: "hello world",
            msgtype: "m.text",
        };

        beforeEach(function() {
            intent = new Intent(botIntent, botClient, {
                ...alreadyRegistered,
                dontCheckPowerLevel: true,
            });
            // not interested in joins, so no-op them.
            intent.onEvent({
                event_id: "test",
                type: "m.room.member",
                state_key: userId,
                room_id: roomId,
                content: {
                    membership: "join"
                }
            });
        });

        it("should immediately try to send the event if joined/have pl", function() {
            underlyingClient.sendEvent.and.returnValue(Promise.resolve({
                event_id: "$abra:kadabra"
            }));
            return intent.sendMessage(roomId, content).then(function() {
                expect(underlyingClient.sendEvent).toHaveBeenCalledWith(
                    roomId, "m.room.message", content
                );
                expect(underlyingClient.joinRoom).not.toHaveBeenCalled();
            });
        });

        it("should fail if get an error that isn't M_FORBIDDEN", function() {
            underlyingClient.sendEvent.and.callFake(() => matrixError(
                "M_UNKNOWN",
                "Oh no",
            ));
            return intent.sendMessage(roomId, content).catch(function() {
                expect(underlyingClient.sendEvent).toHaveBeenCalledWith(
                    roomId, "m.room.message", content
                );
                expect(underlyingClient.joinRoom).not.toHaveBeenCalled();
            });
        });

        it("should try to join the room on M_FORBIDDEN then resend", function() {
            let isJoined = false;
            underlyingClient.sendEvent.and.callFake(function() {
                if (isJoined) {
                    return Promise.resolve("$12345:6789");
                }
                return matrixError(
                    "M_FORBIDDEN",
                    "You are not joined",
                );
            });
            underlyingClient.joinRoom.and.callFake(function(joinRoomId) {
                isJoined = true;
                return Promise.resolve(joinRoomId);
            });
            return intent.sendMessage(roomId, content).then(function(eventId) {
                expect(underlyingClient.sendEvent).toHaveBeenCalledWith(
                    roomId, "m.room.message", content
                );
                expect(underlyingClient.joinRoom).toHaveBeenCalledWith(roomId, undefined);
                expect(eventId).toEqual({event_id: "$12345:6789"});
            });
        });

        it("should fail if the join on M_FORBIDDEN fails", function() {
            underlyingClient.sendEvent.and.callFake(function() {
                return matrixError(
                    "M_FORBIDDEN",
                    "You are not joined",
                );
            });
            underlyingClient.joinRoom.and.callFake(() => matrixError(
                "M_YOU_ARE_A_FISH",
                "Never!",
            ));
            return intent.sendMessage(roomId, content).catch(function() {
                expect(underlyingClient.sendEvent).toHaveBeenCalledWith(
                    roomId, "m.room.message", content
                );
                expect(underlyingClient.joinRoom).toHaveBeenCalledWith(roomId, undefined);
            });
        });

        it("should fail if the resend after M_FORBIDDEN fails", function() {
            let isJoined = false;
            underlyingClient.sendEvent.and.callFake(function() {
                if (isJoined) {
                    return matrixError(
                        "M_WHOOPSIE",
                        "Internal Server Error",
                    );
                }
                return matrixError(
                    "M_FORBIDDEN",
                    "You are not joined",
                );
            });
            underlyingClient.joinRoom.and.callFake(function(joinRoomId) {
                isJoined = true;
                return Promise.resolve(joinRoomId);
            });
            return intent.sendMessage(roomId, content).catch(function() {
                expect(underlyingClient.sendEvent).toHaveBeenCalledWith(
                    roomId, "m.room.message", content
                );
                expect(underlyingClient.joinRoom).toHaveBeenCalledWith(roomId, undefined);
            });
        });
    });

    describe("signaling bridge error", function() {
        const reason = "m.event_not_handled"
        let affectedUsers, eventId, bridge;

        beforeEach(function() {
            intent = new Intent(botIntent, botClient, {
                ...alreadyRegistered,
                dontCheckPowerLevel: true,
            });
            // not interested in joins, so no-op them.
            intent.onEvent({
                event_id: "test",
                type: "m.room.member",
                state_key: userId,
                room_id: roomId,
                content: {
                    membership: "join"
                }
            });
            eventId = "$random:event.id";
            bridge = "International Pidgeon Post";
            affectedUsers = ["@_pidgeonpost_.*:home.server"];
        });

        it("should send an event", function() {
            underlyingClient.sendEvent.and.returnValue(Promise.resolve({
                event_id: "$abra:kadabra"
            }));
            return intent
            .unstableSignalBridgeError(roomId, eventId, bridge, reason, affectedUsers)
            .then(() => {
                expect(underlyingClient.sendEvent).toHaveBeenCalledWith(
                    roomId,
                    "de.nasnotfound.bridge_error",
                    {
                        "network_name": bridge,
                        "reason": reason,
                        "affected_users": affectedUsers,
                        "m.relates_to": {
                            "rel_type": "m.reference",
                            "event_id": eventId
                        }
                    }
                );
                expect(underlyingClient.joinRoom).not.toHaveBeenCalled();
            });
        });
    });
});
