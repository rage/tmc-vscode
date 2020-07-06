import { strictEqual } from "assert";

import { dateToString, findNextDateAfter, parseNextDeadlineAfter } from "../../utils/dateDeadline";

suite("Date utils", () => {
    const CURRENT_TIME = new Date(2020, 3, 1);
    const TARGET_TIME = new Date(2020, 3, 2);
    const PASSED_DATES = [new Date(2020, 1, 1), new Date(2020, 2, 23), new Date(2020, 2, 17)];
    const FUTURE_DATES = [TARGET_TIME, new Date(2020, 6, 1)];
    const TESTSET = PASSED_DATES.concat(FUTURE_DATES);

    test("findNextDateAfter", () => {
        strictEqual(
            findNextDateAfter(CURRENT_TIME, []),
            null,
            "Next date in empty array should be null.",
        );
        strictEqual(
            findNextDateAfter(CURRENT_TIME, [CURRENT_TIME]),
            null,
            "Next date after start date can't be itself.",
        );
        strictEqual(
            findNextDateAfter(CURRENT_TIME, PASSED_DATES),
            null,
            "Next date after too early dates should be null.",
        );
        strictEqual(
            findNextDateAfter(CURRENT_TIME, FUTURE_DATES),
            TARGET_TIME,
            "Next date isn't correct with only later dates.",
        );
        strictEqual(
            findNextDateAfter(CURRENT_TIME, TESTSET),
            TARGET_TIME,
            "Next date isn't correct with both earlier and later dates.",
        );
    });

    test("parseNextDeadline", () => {
        const NO_DEADLINE = "No deadline";
        const ALL_DEADLINES_HAVE_EXPIRED = "All deadlines have expired";

        strictEqual(
            parseNextDeadlineAfter(CURRENT_TIME, []),
            NO_DEADLINE,
            `Parsed deadline from empty array should be "${NO_DEADLINE}"`,
        );
        strictEqual(
            parseNextDeadlineAfter(CURRENT_TIME, [{ date: CURRENT_TIME, active: true }]),
            ALL_DEADLINES_HAVE_EXPIRED,
            "Parsed deadline after current date can't be itself",
        );

        const parsedTarget = parseNextDeadlineAfter(CURRENT_TIME, [
            { date: TARGET_TIME, active: true },
        ]);
        strictEqual(
            parsedTarget,
            `Next deadline: ${dateToString(TARGET_TIME)}`,
            "Parsed deadline from one active target time should be that",
        );
        strictEqual(
            parseNextDeadlineAfter(
                CURRENT_TIME,
                PASSED_DATES.map((x) => ({ date: x, active: true })),
            ),
            ALL_DEADLINES_HAVE_EXPIRED,
            `Parsed deadline after active past dates should be "${ALL_DEADLINES_HAVE_EXPIRED}"`,
        );
        strictEqual(
            parseNextDeadlineAfter(
                CURRENT_TIME,
                PASSED_DATES.map((x) => ({ date: x, active: false })),
            ),
            ALL_DEADLINES_HAVE_EXPIRED,
            `Parsed deadline after inactive past dates should be "${ALL_DEADLINES_HAVE_EXPIRED}"`,
        );
        strictEqual(
            parseNextDeadlineAfter(
                CURRENT_TIME,
                FUTURE_DATES.map((x) => ({ date: x, active: true })),
            ),
            parsedTarget,
            `Parsed deadline from active future dates was expected to be "${parsedTarget}"`,
        );
        strictEqual(
            parseNextDeadlineAfter(
                CURRENT_TIME,
                FUTURE_DATES.map((x) => ({ date: x, active: false })),
            ),
            parsedTarget,
            `Parsed deadline from inactive future dates was expected to be "${parsedTarget}"`,
        );
    });
});
