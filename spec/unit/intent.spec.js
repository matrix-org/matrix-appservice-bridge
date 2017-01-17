"use strict";
var Intent = require("../..").Intent;
var Promise = require("bluebird");
var log = require("../log");

describe("Intent", function() {
    var intent, client, botClient;
    var userId = "@alice:bar";
    var botUserId = "@bot:user";
    var roomId = "!foo:bar";
    var alreadyRegistered = {
        registered: true
    };

    beforeEach(
    /** @this */
    function() {
        log.beforeEach(this);
        var clientFields = [
            "credentials", "joinRoom", "invite", "leave", "ban", "unban",
            "kick", "getStateEvent", "setPowerLevel", "sendTyping", "sendEvent",
            "sendStateEvent", "setDisplayName", "setAvatarUrl"
        ];
        client = jasmine.createSpyObj("client", clientFields);
        client.credentials.userId = userId;
        botClient = jasmine.createSpyObj("botClient", clientFields);
        botClient.credentials.userId = botUserId;
        intent = new Intent(client, botClient, alreadyRegistered);
    });

    describe("join", function() {

        it("should /join/$ROOMID if it doesn't know it is already joined",
        function(done) {
            client.joinRoom.andReturn(Promise.resolve({}));
            intent.join(roomId).done(function() {
                expect(client.joinRoom).toHaveBeenCalledWith(
                    roomId, { syncRoom: false }
                );
                done();
            });
        });

        it("should no-op if it knows it is already joined", function(done) {
            intent.onEvent({
                event_id: "test",
                type: "m.room.member",
                state_key: userId,
                room_id: roomId,
                content: {
                    membership: "join"
                }
            });
            intent.join(roomId).done(function() {
                expect(client.joinRoom).not.toHaveBeenCalled();
                done();
            });
        });

        it("should fail if the join returned an error other than forbidden",
        function(done) {
            client.joinRoom.andReturn(Promise.reject({
                errcode: "M_YOU_ARE_A_FISH",
                error: "you're a fish"
            }));
            intent.join(roomId).catch(function() {
                expect(client.joinRoom).toHaveBeenCalled();
                done();
            });
        });

        describe("client join failed", function() {

            it("should make the bot invite then the client join", function(done) {
                client.joinRoom.andCallFake(function() {
                    if (botClient.invite.calls.length === 0) {
                        return Promise.reject({
                            errcode: "M_FORBIDDEN",
                            error: "Join first"
                        });
                    }
                    return Promise.resolve({});
                });
                botClient.invite.andReturn(Promise.resolve({}));

                intent.join(roomId).done(function() {
                    expect(client.joinRoom).toHaveBeenCalledWith(
                        roomId, { syncRoom: false }
                    );
                    expect(botClient.invite).toHaveBeenCalledWith(roomId, userId);
                    done();
                });
            });

            describe("bot invite failed", function() {
                it("should make the bot join then invite then the client join",
                function(done) {
                    client.joinRoom.andCallFake(function() {
                        if (botClient.invite.calls.length === 0) {
                            return Promise.reject({
                                errcode: "M_FORBIDDEN",
                                error: "Join first"
                            });
                        }
                        return Promise.resolve({});
                    });
                    botClient.invite.andCallFake(function() {
                        if (botClient.joinRoom.calls.length === 0) {
                            return Promise.reject({
                                errcode: "M_FORBIDDEN",
                                error: "Join first"
                            });
                        }
                        return Promise.resolve({});
                    });
                    botClient.joinRoom.andReturn(Promise.resolve({}));

                    intent.join(roomId).done(function() {
                        expect(client.joinRoom).toHaveBeenCalledWith(
                            roomId, { syncRoom: false }
                        );
                        expect(botClient.invite).toHaveBeenCalledWith(roomId, userId);
                        expect(botClient.joinRoom).toHaveBeenCalledWith(
                            roomId, { syncRoom: false }
                        );
                        done();
                    });
                });

                it("should give up if the bot cannot join the room", function(done) {
                    client.joinRoom.andReturn(Promise.reject({
                        errcode: "M_FORBIDDEN",
                        error: "Join first"
                    }));
                    botClient.invite.andReturn(Promise.reject({
                        errcode: "M_FORBIDDEN",
                        error: "No invites kthx"
                    }));
                    botClient.joinRoom.andReturn(Promise.reject({
                        errcode: "M_FORBIDDEN",
                        error: "No bots allowed!"
                    }));

                    intent.join(roomId).catch(function() {
                        expect(client.joinRoom).toHaveBeenCalledWith(
                            roomId, { syncRoom: false }
                        );
                        expect(botClient.invite).toHaveBeenCalledWith(roomId, userId);
                        expect(botClient.joinRoom).toHaveBeenCalledWith(
                            roomId, { syncRoom: false }
                        );
                        done();
                    });
                });
            });
        });
    });

    describe("sending state events", function() {
        var validPowerLevels, invalidPowerLevels;

        beforeEach(function() {
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

            var basePowerLevelEvent = {
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
                user_id: "@example:localhost",
                type: "m.room.power_levels",
                event_id: "test2"
            };
            validPowerLevels = JSON.parse(JSON.stringify(basePowerLevelEvent));
            validPowerLevels.content.users[userId] = 100;
            invalidPowerLevels = basePowerLevelEvent;
        });

        it("should directly send the event if it thinks power levels are ok",
        function(done) {
            client.sendStateEvent.andReturn(Promise.resolve({}));

            intent.onEvent(validPowerLevels);
            intent.setRoomTopic(roomId, "Hello world").done(function() {
                expect(client.sendStateEvent).toHaveBeenCalledWith(
                    roomId, "m.room.topic", {topic: "Hello world"}, ""
                );
                done();
            })
        });

        it("should get the power levels before sending if it doesn't know them",
        function(done) {
            client.sendStateEvent.andReturn(Promise.resolve({}));
            client.getStateEvent.andReturn(Promise.resolve(validPowerLevels.content));

            intent.setRoomTopic(roomId, "Hello world").done(function() {
                expect(client.getStateEvent).toHaveBeenCalledWith(
                    roomId, "m.room.power_levels", ""
                );
                expect(client.sendStateEvent).toHaveBeenCalledWith(
                    roomId, "m.room.topic", {topic: "Hello world"}, ""
                );
                done();
            })
        });

        it("should modify power levels before sending if client is too low",
        function(done) {
            client.sendStateEvent.andCallFake(function() {
                if (botClient.setPowerLevel.calls.length > 0) {
                    return Promise.resolve({});
                }
                return Promise.reject({
                    errcode: "M_FORBIDDEN",
                    error: "Not enough powaaaaaa"
                });
            });
            botClient.setPowerLevel.andReturn(Promise.resolve({}));
            // give the power to the bot
            invalidPowerLevels.content.users[botUserId] = 100;
            intent.onEvent(invalidPowerLevels);

            intent.setRoomTopic(roomId, "Hello world").done(function() {
                expect(client.sendStateEvent).toHaveBeenCalledWith(
                    roomId, "m.room.topic", {topic: "Hello world"}, ""
                );
                expect(botClient.setPowerLevel).toHaveBeenCalledWith(
                    roomId, userId, 50, jasmine.any(Object)
                );
                done();
            })
        });

        it("should fail if the bot cannot modify power levels and the client is too low",
        function(done) {
            // bot has NO power
            intent.onEvent(invalidPowerLevels);

            intent.setRoomTopic(roomId, "Hello world").catch(function() {
                expect(client.sendStateEvent).not.toHaveBeenCalled();
                expect(botClient.setPowerLevel).not.toHaveBeenCalled();
                done();
            })
        });
    });

    describe("sending message events", function() {
        var content = {
            body: "hello world",
            msgtype: "m.text",
        };

        beforeEach(function() {
            intent.opts.dontCheckPowerLevel = true;
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

        it("should immediately try to send the event if joined/have pl", function(done) {
            client.sendEvent.andReturn(Promise.resolve({
                event_id: "$abra:kadabra"
            }));
            intent.sendMessage(roomId, content).done(function() {
                expect(client.sendEvent).toHaveBeenCalledWith(
                    roomId, "m.room.message", content
                );
                expect(client.joinRoom).not.toHaveBeenCalled();
                done();
            });
        });

        it("should fail if get an error that isn't M_FORBIDDEN", function(done) {
            client.sendEvent.andReturn(Promise.reject({
                error: "Oh no",
                errcode: "M_UNKNOWN"
            }));
            intent.sendMessage(roomId, content).catch(function() {
                expect(client.sendEvent).toHaveBeenCalledWith(
                    roomId, "m.room.message", content
                );
                expect(client.joinRoom).not.toHaveBeenCalled();
                done();
            });
        });

        it("should try to join the room on M_FORBIDDEN then resend", function(done) {
            var isJoined = false;
            client.sendEvent.andCallFake(function() {
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
            client.joinRoom.andCallFake(function(joinRoomId) {
                isJoined = true;
                return Promise.resolve({
                    room_id: joinRoomId,
                });
            });
            intent.sendMessage(roomId, content).done(function() {
                expect(client.sendEvent).toHaveBeenCalledWith(
                    roomId, "m.room.message", content
                );
                expect(client.joinRoom).toHaveBeenCalledWith(roomId, { syncRoom: false });
                done();
            });
        });

        it("should fail if the join on M_FORBIDDEN fails", function(done) {
            client.sendEvent.andCallFake(function() {
                return Promise.reject({
                    error: "You are not joined",
                    errcode: "M_FORBIDDEN"
                });
            });
            client.joinRoom.andReturn(Promise.reject({
                error: "Never!",
                errcode: "M_YOU_ARE_A_FISH"
            }));
            intent.sendMessage(roomId, content).catch(function() {
                expect(client.sendEvent).toHaveBeenCalledWith(
                    roomId, "m.room.message", content
                );
                expect(client.joinRoom).toHaveBeenCalledWith(roomId, { syncRoom: false });
                done();
            });
        });

        it("should fail if the resend after M_FORBIDDEN fails", function(done) {
            var isJoined = false;
            client.sendEvent.andCallFake(function() {
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
            client.joinRoom.andCallFake(function(joinRoomId) {
                isJoined = true;
                return Promise.resolve({
                    room_id: joinRoomId,
                });
            });
            intent.sendMessage(roomId, content).catch(function() {
                expect(client.sendEvent).toHaveBeenCalledWith(
                    roomId, "m.room.message", content
                );
                expect(client.joinRoom).toHaveBeenCalledWith(roomId, { syncRoom: false });
                done();
            });
        });
    });
});
