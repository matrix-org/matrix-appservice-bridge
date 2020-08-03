const RVL = require("../../lib/components/room-link-validator")
const RoomLinkValidator = RVL.RoomLinkValidator;
const Statuses = RVL.validationStatuses;

const AsBotMock = {
    cachedCalled: false,
    getJoinedMembers: (roomId) => {
        switch (roomId) {
            case "!empty:localhost":
                return Promise.resolve({
                    joined: {}
                });
            case "!noconflict:localhost":
                return Promise.resolve({
                    joined: {
                        "@test2-u1:localhost": true,
                        "@test2-u2:localhost": true,
                        "@test2-u3:localhost": true,
                        "@test2-u4:localhost": true,
                    }
                });
            case "!conflictexempt:localhost":
                return Promise.resolve({
                    joined: {
                        "@test3-u1:localhost": true,
                        "@test3-u11:localhost": true,
                        "@test3-u111:localhost": true,
                        "@test3-u1111:localhost": true,
                    }
                });
            case "!conflicts:localhost":
                return Promise.resolve({
                    joined: {
                        "@test4-u1:localhost": true,
                        "@test4-u2:localhost": true,
                        "@test4-u3:localhost": true,
                        "@test4-u4:localhost": true,
                    }
                });
            case "!cached:localhost":
                if (AsBotMock.cachedCalled) {
                    return Promise.resolve({
                        joined: {}
                    });
                }
                AsBotMock.cachedCalled = true;
                return Promise.resolve({
                    joined: {
                        "@test5-u1:localhost": true,
                        "@test5-u2:localhost": true,
                        "@test5-u3:localhost": true,
                        "@test5-u4:localhost": true,
                    }
                });
            default:
                throw Error("unexpected roomid for test");
        }
    }
};

describe("RoomLinkValidator", function() {
    describe("constructor", function() {
        it("should construct with ruleset", () => {
            const validator = new RoomLinkValidator({
                rules: { }
            }, AsBotMock, () => {});
            expect(validator.rules).toEqual({userIds:{
                conflict: [],
                exempt: [],
            }});
        });
        /* eslint-disable no-new */
        it("should throw if not given any args", () => {
            expect(() => {
                new RoomLinkValidator({
                }, AsBotMock, () => {});
            }).toThrowError("Either config.ruleFile or config.rules must be set");
        });
        /* eslint-enable no-new */
    });
    describe("reEvaluateRules", function() {
        it("should construct some regexes", () => {
            const validator = new RoomLinkValidator({
                rules: {
                    userIds: {
                        conflict: [
                            "@bad-bridge:localhost",
                            "@bad-.+:localhost"
                        ],
                        exempt: [
                            "@good-bridge:localhost",
                            "@good-.+:localhost"
                        ]
                    }
                }
            }, AsBotMock, () => {});
            expect(validator.rules).toEqual({userIds:{
                conflict: [
                    /@bad-bridge:localhost/,
                    /@bad-.+:localhost/
                ],
                exempt: [
                    /@good-bridge:localhost/,
                    /@good-.+:localhost/
                ],
            }});
        });
    });
    describe("validateRoom", function() {
        let validator;
        beforeEach(() => {
            validator = new RoomLinkValidator({
                rules: {
                    userIds: {
                        conflict: [
                            "@test3-.*",
                            "@test4-.*",
                            "@test5-.*"
                        ],
                        exempt: [
                            "@test3-u1.*"
                        ]
                    }
                }
            }, AsBotMock, () => {});
            AsBotMock.cachedCalled = false;
        });
        it("should pass an empty room", function() {
            return validator.validateRoom("!empty:localhost").then((status) => {
                expect(status).toBe(Statuses.PASSED);
            })
        });
        it("should pass a room that doesn't conflict", function() {
            return validator.validateRoom("!noconflict:localhost").then((status) => {
                expect(status).toBe(Statuses.PASSED);
            })
        });
        it("should pass a room that conflicts but has exemptions", function() {
            return validator.validateRoom("!conflictexempt:localhost").then((status) => {
                expect(status).toBe(Statuses.PASSED);
            })
        });
        it("should reject a room that conflicts", function() {
            return validator.validateRoom("!conflicts:localhost").catch((status) => {
                expect(status).toBe(Statuses.ERROR_USER_CONFLICT);
            })
        });
        it("should continue to reject a room when it's cached", function() {
            return validator.validateRoom("!cached:localhost").catch((status) => {
                expect(status).toBe(Statuses.ERROR_USER_CONFLICT);
                return validator.validateRoom("!cached:localhost");
            }).catch((status) => {
                expect(status).toBe(Statuses.ERROR_CACHED);
            });
        });
    });
});
