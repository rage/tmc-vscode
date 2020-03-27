import * as assert from "assert";
import { findNextDateAfter } from "../utils/utils";

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
            "Next cate isn't correct with both earlier and later dates.",
        );
    });
});
