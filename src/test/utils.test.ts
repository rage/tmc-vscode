import * as assert from "assert";
import { findNextDateAfter } from "../utils/dateDeadline";
import { formatSizeInBytes } from "../utils/utils";

suite("Date utils", () => {
    test("findNextDateAfter", () => {
        const after = new Date(2020, 3, 1);
        const target = new Date(2020, 3, 2);
        const tooEarlyDates = [new Date(2020, 1, 1), new Date(2020, 2, 23), new Date(2020, 2, 17)];
        const laterDates = [target, new Date(2020, 6, 1)];
        const dates = tooEarlyDates.concat(laterDates);

        assert.equal(
            findNextDateAfter(after, []),
            null,
            "Next date in empty array should be null.",
        );
        assert.equal(
            findNextDateAfter(after, [after]),
            null,
            "Next date after start date can't be itself.",
        );
        assert.equal(
            findNextDateAfter(after, tooEarlyDates),
            null,
            "Next date after too early dates should be null.",
        );
        assert.equal(
            findNextDateAfter(after, laterDates),
            target,
            "Next date isn't correct with only later dates.",
        );
        assert.equal(
            findNextDateAfter(after, dates),
            target,
            "Next date isn't correct with both earlier and later dates.",
        );
    });
});
suite("Number formatting utils", () => {
    test("formatSizeInBytes", () => {
        const testCases = [
            { in: 1, p: 1, out: "1 B" },
            { in: 2, p: 3, out: "2 B" },
            { in: 999, p: 4, out: "999 B" },
            { in: 1000, p: undefined, out: "1.00 kB" },
            { in: 1001, p: 3, out: "1.00 kB" },
            { in: 1008, p: 3, out: "1.01 kB" },
            { in: 999994, p: 1, out: "1 MB" },
            { in: 999994, p: 4, out: "1.000 MB" },
            { in: 999994, p: 5, out: "999.99 kB" },
            { in: 999994, p: 6, out: "999.994 kB" },
            { in: 999999, p: 500, out: "999.999 kB" },
            { in: 1001000, p: 3, out: "1.00 MB" },
            { in: 1008000, p: 3, out: "1.01 MB" },
        ];
        for (const testCase of testCases) {
            assert.equal(formatSizeInBytes(testCase.in, testCase.p), testCase.out);
        }
    });
});
