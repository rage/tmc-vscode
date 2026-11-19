import * as path from "path"

import { isPathInside, isSamePath } from "../../utilities/utils"

suite("Path utils", function () {
  test("isPathInside on Windows", function () {
    const exercise = "C:\\Users\\student\\tmc\\course\\part1-01"
    const testCases = [
      { child: exercise, out: true },
      { child: exercise + "\\src\\main.py", out: true },
      { child: "c:\\users\\STUDENT\\tmc\\course\\part1-01\\src", out: true },
      { child: "C:/Users/student/tmc/course/part1-01/src", out: true },
      { child: "C:\\Users\\student\\tmc\\course\\part1-02", out: false },
      { child: "C:\\Users\\student\\tmc\\course\\part1-01-extra", out: false },
      { child: "D:\\Users\\student\\tmc\\course\\part1-01\\src", out: false },
      { child: "\\\\server\\share\\part1-01", out: false },
    ]
    for (const testCase of testCases) {
      expect(isPathInside(exercise, testCase.child, path.win32), testCase.child).toBe(testCase.out)
    }
  })

  test("isPathInside on POSIX", function () {
    const exercise = "/home/student/tmc/course/part1-01"
    const testCases = [
      { child: exercise, out: true },
      { child: exercise + "/src/main.py", out: true },
      { child: exercise + "/..hidden", out: true },
      { child: "/home/student/tmc/course/part1-02", out: false },
      { child: "/home/student/tmc/course", out: false },
    ]
    for (const testCase of testCases) {
      expect(isPathInside(exercise, testCase.child, path.posix), testCase.child).toBe(testCase.out)
    }
  })

  test("isSamePath on Windows", function () {
    const file = "C:\\Users\\student\\course.code-workspace"
    expect(isSamePath(file, "c:/users/STUDENT/course.code-workspace", path.win32)).toBe(true)
    expect(isSamePath(file, "D:\\Users\\student\\course.code-workspace", path.win32)).toBe(false)
  })
})
