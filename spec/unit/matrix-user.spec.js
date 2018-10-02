const MatrixUser = require("../../lib/models/users/matrix");

describe("MatrixUser", function() {
    describe("escapeUserId", function() {
        it("should not escape acceptable user ids", function() {
            [
                new MatrixUser("@test:localhost", null, false),
                new MatrixUser("@42:localhost", null, false),
                new MatrixUser("@Test42:localhost", null, false),
                new MatrixUser("@A=Good-set.of_chars:localhost", null, false)
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
            ];
            [
                new MatrixUser("@$:localhost", null, false),
                new MatrixUser("@500$ dog:localhost", null, false),
                new MatrixUser("@woah***:localhost", null, false),
                new MatrixUser("@🐶:localhost", null, false),
                new MatrixUser("@matrix.org/spec:localhost", null, false)
            ].forEach((user, i) => {
                user.escapeUserId();
                expect(user.getId()).toBe(expected[i]);
            })
        });
    });
});
