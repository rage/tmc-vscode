import { formatSizeInBytes, isPathInside } from "../../utilities/utils";
import * as assert from "assert";
import * as path from "path";

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

suite("Path utils", () => {
    test("isPathInside on Windows", () => {
        const exercise = "C:\\Users\\student\\tmc\\course\\part1-01";
        const testCases = [
            { child: exercise, out: true },
            { child: exercise + "\\src\\main.py", out: true },
            { child: "c:\\users\\STUDENT\\tmc\\course\\part1-01\\src", out: true },
            { child: "C:/Users/student/tmc/course/part1-01/src", out: true },
            { child: "C:\\Users\\student\\tmc\\course\\part1-02", out: false },
            { child: "C:\\Users\\student\\tmc\\course\\part1-01-extra", out: false },
            { child: "D:\\Users\\student\\tmc\\course\\part1-01\\src", out: false },
            { child: "\\\\server\\share\\part1-01", out: false },
        ];
        for (const testCase of testCases) {
            assert.equal(isPathInside(exercise, testCase.child, path.win32), testCase.out);
        }
    });

    test("isPathInside on POSIX", () => {
        const exercise = "/home/student/tmc/course/part1-01";
        const testCases = [
            { child: exercise, out: true },
            { child: exercise + "/src/main.py", out: true },
            { child: exercise + "/..hidden", out: true },
            { child: "/home/student/tmc/course/part1-02", out: false },
            { child: "/home/student/tmc/course", out: false },
        ];
        for (const testCase of testCases) {
            assert.equal(isPathInside(exercise, testCase.child, path.posix), testCase.out);
        }
    });
});
