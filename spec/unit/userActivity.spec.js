const { UserActivityTracker, UserActivityTrackerConfig  } = require("../../lib/components/userActivity")

const DATE_MINUS_TWO = new Date(Date.UTC(2020, 12, 30, 0));
const DATE_MINUS_ONE = new Date(Date.UTC(2020, 12, 31, 0));
const DATE_NOW = new Date(Date.UTC(2021, 1, 1, 0));
const USER_ONE = "@alice:example.com";
const USER_TWO = "@bob:example.com";
const USER_THREE = "@charlie:example.com";
const ONE_DAY = 24 * 60 * 60 * 1000;

describe("userActivity", () => {
    const mockStorage = { set: async () => {} };
    const emptyDataSet = () => { return { users: {} } };
    describe("updateUserActivity", () => {
        it("can update a user's activity", async () => {
            let userData;
            const trackerPromise = new Promise((resolve, _) => {
                const tracker = new UserActivityTracker(
                    UserActivityTrackerConfig.DEFAULT,
                    emptyDataSet(),
                    { set: async (data) => resolve(data) },
                );
                tracker.updateUserActivity(USER_ONE, undefined, DATE_NOW);
                userData = tracker.getUserData(USER_ONE);
                expect(userData).toEqual({
                    ts: [DATE_NOW.getTime() / 1000],
                    metadata: {},
                });
            });
            // This data is comitted asyncronously.
            const data = await trackerPromise;
            expect(data).toEqual({
                users: {[USER_ONE]: userData}
            });
        });
        it("can update a user's activity with metadata", () => {
            const tracker = new UserActivityTracker(
                UserActivityTrackerConfig.DEFAULT,
                emptyDataSet(),
                mockStorage,
            );
            tracker.updateUserActivity(USER_ONE, { private: true }, DATE_NOW);
            expect(tracker.getUserData(USER_ONE)).toEqual({
                ts: [DATE_NOW.getTime() / 1000],
                metadata: {
                    private: true,
                }
            });
        });
        it("can update a user's activity twice", () => {
            const tracker = new UserActivityTracker(
                UserActivityTrackerConfig.DEFAULT,
                emptyDataSet(),
                mockStorage,
            );
            tracker.updateUserActivity(USER_ONE, undefined, DATE_MINUS_ONE);
            tracker.updateUserActivity(USER_ONE, undefined, DATE_NOW);
            expect(tracker.getUserData(USER_ONE)).toEqual({
                ts: [
                    DATE_NOW.getTime() / 1000,
                    DATE_MINUS_ONE.getTime() / 1000,
                ],
                metadata: {},
            });
        });
        it("will not remove metadata from a user", () => {
            const tracker = new UserActivityTracker(
                UserActivityTrackerConfig.DEFAULT,
                emptyDataSet(),
                mockStorage,
            );
            tracker.updateUserActivity(USER_ONE, { private: true}, DATE_MINUS_ONE);
            tracker.updateUserActivity(USER_ONE, undefined, DATE_NOW);
            expect(tracker.getUserData(USER_ONE)).toEqual({
                ts: [
                    DATE_NOW.getTime() / 1000,
                    DATE_MINUS_ONE.getTime() / 1000,
                ],
                metadata: {
                    private: true,
                }
            });
        });
        it("will cut off a users activity after 31 days", () => {
            const tracker = new UserActivityTracker(
                UserActivityTrackerConfig.DEFAULT,
                emptyDataSet(),
                mockStorage,
            );
            const LAST_EXPECTED_DATE = (DATE_NOW.getTime() - (ONE_DAY * 30)) / 1000;
            for (let index = 40; index >= 0; index--) {
                const date = new Date(DATE_NOW.getTime() - (ONE_DAY * index));
                tracker.updateUserActivity(USER_ONE, undefined, date);
            }
            const data = tracker.getUserData(USER_ONE);
            expect(data.ts.length).toEqual(31);
            expect(data.ts[30]).toEqual(LAST_EXPECTED_DATE);
        });
    });
    describe("countActiveUsers", () => {
        it("should have no users when the dataset is blank", () => {
            const tracker = new UserActivityTracker(
                UserActivityTrackerConfig.DEFAULT,
                emptyDataSet(),
                mockStorage,
            );
            expect(tracker.countActiveUsers(DATE_NOW)).toEqual({
                allUsers: 0,
                privateUsers: 0,
            });
        });
        it("should have no users when the user hasn't been active for 3 days", () => {
            const tracker = new UserActivityTracker(
                UserActivityTrackerConfig.DEFAULT,
                emptyDataSet(),
                mockStorage,
            );
            tracker.updateUserActivity(USER_ONE, undefined, DATE_MINUS_ONE);
            tracker.updateUserActivity(USER_ONE, undefined, DATE_NOW);
            expect(tracker.countActiveUsers(DATE_NOW)).toEqual({
                allUsers: 0,
                privateUsers: 0,
            });
        });
        it("should have users when the user has been active for at least 3 days", () => {
            const tracker = new UserActivityTracker(
                UserActivityTrackerConfig.DEFAULT,
                emptyDataSet(),
                mockStorage,
            );
            tracker.updateUserActivity(USER_ONE, undefined, DATE_MINUS_TWO);
            tracker.updateUserActivity(USER_ONE, undefined, DATE_MINUS_ONE);
            tracker.updateUserActivity(USER_ONE, undefined, DATE_NOW);
            expect(tracker.countActiveUsers(DATE_NOW)).toEqual({
                allUsers: 1,
                privateUsers: 0,
            });
        });
        it("should not include 'active' users who have not talked in 32 days", () => {
            const DATE_MINUS_THIRTY_TWO = new Date(Date.UTC(2020, 11, 30, 0));
            const tracker = new UserActivityTracker(
                UserActivityTrackerConfig.DEFAULT,
                {
                    users: {
                        [USER_ONE]: {
                            ts: [DATE_MINUS_THIRTY_TWO.getTime() / 1000],
                            metadata: {
                                active: true,
                            }
                        }
                    }
                },
                mockStorage,
            );
            expect(tracker.countActiveUsers(DATE_NOW)).toEqual({
                allUsers: 0,
                privateUsers: 0,
            });
        });
        it("should include 'active' users who have talked in 31 days", () => {
            const DATE_MINUS_THIRTY_ONE = new Date(Date.UTC(2020, 12, 1, 0));
            const tracker = new UserActivityTracker(
                UserActivityTrackerConfig.DEFAULT,
                {
                    users: {
                        [USER_ONE]: {
                            ts: [DATE_MINUS_THIRTY_ONE.getTime() / 1000],
                            metadata: {
                                active: true,
                            }
                        }
                    }
                },
                mockStorage,
            );
            expect(tracker.countActiveUsers(DATE_NOW)).toEqual({
                allUsers: 1,
                privateUsers: 0,
            });
        });
        it("should mark user as private if metadata specifies it", () => {
            const tracker = new UserActivityTracker(
                UserActivityTrackerConfig.DEFAULT,
                emptyDataSet(),
                mockStorage,
            );
            tracker.updateUserActivity(USER_ONE, { private: true}, DATE_MINUS_TWO);
            tracker.updateUserActivity(USER_ONE, undefined, DATE_MINUS_ONE);
            tracker.updateUserActivity(USER_ONE, undefined, DATE_NOW);
            expect(tracker.countActiveUsers(DATE_NOW)).toEqual({
                allUsers: 1,
                privateUsers: 1,
            });
        });
        it("should handle multiple users", () => {
            const tracker = new UserActivityTracker(
                UserActivityTrackerConfig.DEFAULT,
                emptyDataSet(),
                mockStorage,
            );
            tracker.updateUserActivity(USER_ONE, { private: true }, DATE_MINUS_TWO);
            tracker.updateUserActivity(USER_ONE, undefined, DATE_MINUS_ONE);
            tracker.updateUserActivity(USER_ONE, undefined, DATE_NOW);
            tracker.updateUserActivity(USER_TWO, undefined, DATE_MINUS_TWO);
            tracker.updateUserActivity(USER_TWO, undefined, DATE_MINUS_ONE);
            tracker.updateUserActivity(USER_TWO, undefined, DATE_NOW);
            tracker.updateUserActivity(USER_THREE, undefined, DATE_NOW);
            expect(tracker.countActiveUsers(DATE_NOW)).toEqual({
                allUsers: 2,
                privateUsers: 1,
            });
        });
    })
})
