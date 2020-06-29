import * as assert from "assert";
import { formatSizeInBytes } from "../../utils/utils";

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
