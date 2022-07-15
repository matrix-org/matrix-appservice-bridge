const MatrixUser = require("../..").MatrixUser;

describe("MatrixUser", function() {
    describe("escapeUserId", function() {
        it("should not escape acceptable user ids", function() {
            [
                new MatrixUser("@test:localhost", null, false),
                new MatrixUser("@42:localhost", null, false),
                new MatrixUser("@Test42:localhost", null, false),
                new MatrixUser("@A=Good-set.of_chars:localhost", null, false),
                new MatrixUser("@testoo:[1234:5678::abcd]:5678", null, false),
                new MatrixUser("@testalso:localhost:9999", null, false),
                new MatrixUser("@testthree:[1234:5678::abcd]", null, false)
            ].forEach((user) => {
                const userId = user.getId();
                user.escapeUserId();
                expect(user.getId()).toBe(userId);
            })
        });
        it("should escape unacceptable user ids", function() {
            const expected = [
                "@=24:localhost",
                "@500=24=20dog:localhost",
                "@woah=2a=2a=2a:localhost",
                "@=d83d:localhost",
                "@matrix.org=2fspec:localhost",
                "@=5bdoggo=5d:localhost"
            ];
            [
                new MatrixUser("@$:localhost", null, false),
                new MatrixUser("@500$ dog:localhost", null, false),
                new MatrixUser("@woah***:localhost", null, false),
                new MatrixUser("@🐶:localhost", null, false),
                new MatrixUser("@matrix.org/spec:localhost", null, false),
                new MatrixUser("@[doggo]:localhost", null, false)
            ].forEach((user, i) => {
                user.escapeUserId();
                expect(user.getId()).toBe(expected[i]);
            })
        });
        it("should not escape if ESCAPE_DEFAULT is false", function() {
            MatrixUser.ESCAPE_DEFAULT = false;
            expect(new MatrixUser("@$:localhost", null).getId()).toBe("@$:localhost");
        });
        it("should escape if ESCAPE_DEFAULT is true", function() {
            MatrixUser.ESCAPE_DEFAULT = true;
            expect(new MatrixUser("@$:localhost", null).getId()).toBe("@=24:localhost");
        });
        it("should accept server names with explicit port or an ipv6 literal", function() {
            const mxids = [
                "@testoo:[1234:5678::abcd]:5678",
                "@testalso:localhost:9999",
                "@testthree:[1234:5678::abcd]"
            ];
            mxids
                .map(mxid => new MatrixUser(mxid, null, false))
                .forEach((user, i) => {
                    expect(user.getId()).toBe(mxids[i]);
                });
        });
    });
});
