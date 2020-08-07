"use strict";
const Intent = require("../..").Intent;
const log = require("../log");

describe("Intent", function() {
    let intent, client, botClient;
    const userId = "@alice:bar";
    const botUserId = "@bot:user";
    const roomId = "!foo:bar";
    const alreadyRegistered = {
        registered: true
    };

    beforeEach(
    /** @this */
    function() {
        log.beforeEach(this);
        const clientFields = [
            "credentials", "joinRoom", "invite", "leave", "ban", "unban",
            "kick", "getStateEvent", "setPowerLevel", "sendTyping", "sendEvent",
            "sendStateEvent", "setDisplayName", "setAvatarUrl",
        ];
        client = jasmine.createSpyObj("client", clientFields);
        client.credentials.userId = userId;
        botClient = jasmine.createSpyObj("botClient", clientFields);
        botClient.credentials.userId = botUserId;
        intent = new Intent(client, botClient, alreadyRegistered);
    });

    describe("join", function() {

        it("should /join/$ROOMID if it doesn't know it is already joined",
        function() {
            client.joinRoom.and.callFake(() => Promise.resolve({}));
            return intent.join(roomId).then(function() {
                expect(client.joinRoom).toHaveBeenCalledWith(
                    roomId, { syncRoom: false }
                );
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
            return intent.join(roomId).then(function() {
                expect(client.joinRoom).not.toHaveBeenCalled();
            });
        });

        it("should fail if the join returned an error other than forbidden",
        function() {
            client.joinRoom.and.callFake(() => Promise.reject({
                errcode: "M_YOU_ARE_A_FISH",
                error: "you're a fish"
            }));
            return intent.join(roomId).catch(function() {
                expect(client.joinRoom).toHaveBeenCalled();
            });
        });

        describe("client join failed", function() {

            it("should make the bot invite then the client join", function() {
                client.joinRoom.and.callFake(function() {
                    if (botClient.invite.calls.count() === 0) {
                        return Promise.reject({
                            errcode: "M_FORBIDDEN",
                            error: "Join first"
                        });
                    }
                    return Promise.resolve({});
                });
                botClient.invite.and.callFake(() => Promise.resolve({}));

                return intent.join(roomId).then(function() {
                    expect(client.joinRoom).toHaveBeenCalledWith(
                        roomId, { syncRoom: false }
                    );
                    expect(botClient.invite).toHaveBeenCalledWith(roomId, userId);
                });
            });

            describe("bot invite failed", function() {
                it("should make the bot join then invite then the client join",
                function() {
                    client.joinRoom.and.callFake(function() {
                        if (botClient.invite.calls.count() === 0) {
                            return Promise.reject({
                                errcode: "M_FORBIDDEN",
                                error: "Join first"
                            });
                        }
                        return Promise.resolve({});
                    });
                    botClient.invite.and.callFake(function() {
                        if (botClient.joinRoom.calls.count() === 0) {
                            return Promise.reject({
                                errcode: "M_FORBIDDEN",
                                error: "Join first"
                            });
                        }
                        return Promise.resolve({});
                    });
                    botClient.joinRoom.and.callFake(() => Promise.resolve({}));

                    return intent.join(roomId).then(function() {
                        expect(client.joinRoom).toHaveBeenCalledWith(
                            roomId, { syncRoom: false }
                        );
                        expect(botClient.invite).toHaveBeenCalledWith(roomId, userId);
                        expect(botClient.joinRoom).toHaveBeenCalledWith(
                            roomId, { syncRoom: false }
                        );
                    });
                });

                it("should give up if the bot cannot join the room", function() {
                    client.joinRoom.and.callFake(() => Promise.reject({
                        errcode: "M_FORBIDDEN",
                        error: "Join first"
                    }));
                    botClient.invite.and.callFake(() => Promise.reject({
                        errcode: "M_FORBIDDEN",
                        error: "No invites kthx"
                    }));
                    botClient.joinRoom.and.callFake(() => Promise.reject({
                        errcode: "M_FORBIDDEN",
                        error: "No bots allowed!"
                    }));

                    return intent.join(roomId).catch(function() {
                        expect(client.joinRoom).toHaveBeenCalledWith(
                            roomId, { syncRoom: false }
                        );
                        expect(botClient.invite).toHaveBeenCalledWith(roomId, userId);
                        expect(botClient.joinRoom).toHaveBeenCalledWith(
                            roomId, { syncRoom: false }
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
            client.sendStateEvent.and.returnValue(Promise.resolve({}));

            intent.onEvent(validPowerLevels);
            return intent.setRoomTopic(roomId, "Hello world").then(function() {
                expect(client.sendStateEvent).toHaveBeenCalledWith(
                    roomId, "m.room.topic", {topic: "Hello world"}, ""
                );
            })
        });

        it("should get the power levels before sending if it doesn't know them",
        function() {
            client.sendStateEvent.and.returnValue(Promise.resolve({}));
            client.getStateEvent.and.returnValue(
                Promise.resolve(validPowerLevels.content)
            );

            return intent.setRoomTopic(roomId, "Hello world").then(function() {
                expect(client.getStateEvent).toHaveBeenCalledWith(
                    roomId, "m.room.power_levels", ""
                );
                expect(client.sendStateEvent).toHaveBeenCalledWith(
                    roomId, "m.room.topic", {topic: "Hello world"}, ""
                );
            })
        });

        it("should modify power levels before sending if client is too low",
        function() {
            client.sendStateEvent.and.callFake(function() {
                if (botClient.setPowerLevel.calls.count() > 0) {
                    return Promise.resolve({});
                }
                return Promise.reject({
                    errcode: "M_FORBIDDEN",
                    error: "Not enough powaaaaaa"
                });
            });
            botClient.setPowerLevel.and.returnValue(Promise.resolve({}));
            // give the power to the bot
            invalidPowerLevels.content.users[botUserId] = 100;
            intent.onEvent(invalidPowerLevels);

            return intent.setRoomTopic(roomId, "Hello world").then(function() {
                expect(client.sendStateEvent).toHaveBeenCalledWith(
                    roomId, "m.room.topic", {topic: "Hello world"}, ""
                );
                expect(botClient.setPowerLevel).toHaveBeenCalledWith(
                    roomId, userId, 50, jasmine.any(Object)
                );
            })
        });

        it("should fail if the bot cannot modify power levels and the client is too low",
        function() {
            // bot has NO power
            intent.onEvent(invalidPowerLevels);

            return intent.setRoomTopic(roomId, "Hello world").catch(function() {
                expect(client.sendStateEvent).not.toHaveBeenCalled();
                expect(botClient.setPowerLevel).not.toHaveBeenCalled();
            })
        });
    });

    describe("sending message events", function() {
        const content = {
            body: "hello world",
            msgtype: "m.text",
        };

        beforeEach(function() {
            intent = new Intent(client, botClient, {
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
            client.sendEvent.and.returnValue(Promise.resolve({
                event_id: "$abra:kadabra"
            }));
            return intent.sendMessage(roomId, content).then(function() {
                expect(client.sendEvent).toHaveBeenCalledWith(
                    roomId, "m.room.message", content
                );
                expect(client.joinRoom).not.toHaveBeenCalled();
            });
        });

        it("should fail if get an error that isn't M_FORBIDDEN", function() {
            client.sendEvent.and.callFake(() => Promise.reject({
                error: "Oh no",
                errcode: "M_UNKNOWN"
            }));
            return intent.sendMessage(roomId, content).catch(function() {
                expect(client.sendEvent).toHaveBeenCalledWith(
                    roomId, "m.room.message", content
                );
                expect(client.joinRoom).not.toHaveBeenCalled();
            });
        });

        it("should try to join the room on M_FORBIDDEN then resend", function() {
            let isJoined = false;
            client.sendEvent.and.callFake(function() {
                if (isJoined) {
                    return Promise.resolve({
                        event_id: "$12345:6789"
                    });
                }
                return Promise.reject({
                    error: "You are not joined",
                    errcode: "M_FORBIDDEN"
                });
            });
            client.joinRoom.and.callFake(function(joinRoomId) {
                isJoined = true;
                return Promise.resolve({
                    room_id: joinRoomId,
                });
            });
            return intent.sendMessage(roomId, content).then(function() {
                expect(client.sendEvent).toHaveBeenCalledWith(
                    roomId, "m.room.message", content
                );
                expect(client.joinRoom).toHaveBeenCalledWith(roomId, { syncRoom: false });
            });
        });

        it("should fail if the join on M_FORBIDDEN fails", function() {
            client.sendEvent.and.callFake(function() {
                return Promise.reject({
                    error: "You are not joined",
                    errcode: "M_FORBIDDEN"
                });
            });
            client.joinRoom.and.callFake(() => Promise.reject({
                error: "Never!",
                errcode: "M_YOU_ARE_A_FISH"
            }));
            return intent.sendMessage(roomId, content).catch(function() {
                expect(client.sendEvent).toHaveBeenCalledWith(
                    roomId, "m.room.message", content
                );
                expect(client.joinRoom).toHaveBeenCalledWith(roomId, { syncRoom: false });
            });
        });

        it("should fail if the resend after M_FORBIDDEN fails", function() {
            let isJoined = false;
            client.sendEvent.and.callFake(function() {
                if (isJoined) {
                    return Promise.reject({
                        error: "Internal Server Error",
                        errcode: "M_WHOOPSIE",
                    });
                }
                return Promise.reject({
                    error: "You are not joined",
                    errcode: "M_FORBIDDEN",
                });
            });
            client.joinRoom.and.callFake(function(joinRoomId) {
                isJoined = true;
                return Promise.resolve({
                    room_id: joinRoomId,
                });
            });
            return intent.sendMessage(roomId, content).catch(function() {
                expect(client.sendEvent).toHaveBeenCalledWith(
                    roomId, "m.room.message", content
                );
                expect(client.joinRoom).toHaveBeenCalledWith(roomId, { syncRoom: false });
            });
        });
    });

    describe("signaling bridge error", function() {
        const reason = "m.event_not_handled"
        let affectedUsers, eventId, bridge;

        beforeEach(function() {
            intent = new Intent(client, botClient, {
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
            client.sendEvent.and.returnValue(Promise.resolve({
                event_id: "$abra:kadabra"
            }));
            return intent
            .unstableSignalBridgeError(roomId, eventId, bridge, reason, affectedUsers)
            .then(() => {
                expect(client.sendEvent).toHaveBeenCalledWith(
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
                expect(client.joinRoom).not.toHaveBeenCalled();
            });
        });
    });
});
