const { BridgeBlocker } = require("../..");

describe("bridgeBlocker", () => {
    it('should block/unblock as expected', () => {
        const sut = new BridgeBlocker(5);
        expect(sut.isBlocked).toBeFalsy();
        sut.checkLimits(5);
        expect(sut.isBlocked).toBeFalsy();
        sut.checkLimits(6);
        expect(sut.isBlocked).toBeTruthy();
        sut.checkLimits(5);
        expect(sut.isBlocked).toBeFalsy();
    });

    it('should allow for overriding blocking/unblocking', async () => {
        class TestBlocker extends BridgeBlocker {
            calls = {
                block:   0,
                unblock: 0,
            };

            constructor(limit) {
                super(limit);
            }

            async blockBridge() {
                expect(this.isBlocked).toBeFalsy();
                await super.blockBridge();
                expect(this.isBlocked).toBeTruthy();

                this.calls.block++;
            }

            async unblockBridge() {
                expect(this.isBlocked).toBeTruthy();
                await super.unblockBridge();
                expect(this.isBlocked).toBeFalsy();

                this.calls.unblock++;
            }
        }

        const sut = new TestBlocker(5);
        expect(sut.isBlocked).toBeFalsy();
        await sut.checkLimits(5);
        expect(sut.isBlocked).toBeFalsy();
        await sut.checkLimits(6);
        expect(sut.isBlocked).toBeTruthy();
        await sut.checkLimits(5);
        expect(sut.isBlocked).toBeFalsy();

        expect(sut.calls.block).toBe(1);
        expect(sut.calls.unblock).toBe(1);
    });

    it('should catch errors thrown by custom method implementations', async () => {
        class TestBlocker extends BridgeBlocker {
            calls = 0;

            constructor(limit) {
                super(limit);
            }

            async blockBridge() {
                this.calls++;
                throw new Error("oh no");
            }
        }

        const sut = new TestBlocker(5);
        expect(sut.isBlocked).toBeFalsy();
        await sut.checkLimits(6);
        expect(sut.calls).toBe(1);
        expect(sut.isBlocked).toBeFalsy();

        await sut.checkLimits(6);
        expect(sut.calls).toBe(2);
        expect(sut.isBlocked).toBeFalsy();
    });
});
