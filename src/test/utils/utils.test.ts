import * as path from "path"

import type { ExtensionContext } from "vscode"

import { cliFolder, isPathInside, isSamePath, legacyCliFolder } from "../../utilities/utils"

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

function setHost(platform: string, appData?: string, localAppData?: string): void {
  Object.defineProperty(process, "platform", { value: platform, configurable: true })
  for (const [key, value] of [
    ["APPDATA", appData],
    ["LOCALAPPDATA", localAppData],
  ] as const) {
    if (value === undefined) {
      Reflect.deleteProperty(process.env, key)
    } else {
      process.env[key] = value
    }
  }
}

suite("cliFolder", function () {
  const roamingStorage =
    "C:\\Users\\student\\AppData\\Roaming\\Code\\User\\globalStorage\\moocfi.test-my-code"
  const context = { globalStorageUri: { fsPath: roamingStorage } } as ExtensionContext
  const saved = {
    platform: Object.getOwnPropertyDescriptor(process, "platform") as PropertyDescriptor,
    appData: process.env.APPDATA,
    localAppData: process.env.LOCALAPPDATA,
  }

  afterEach(function () {
    Object.defineProperty(process, "platform", saved.platform)
    for (const [key, value] of [
      ["APPDATA", saved.appData],
      ["LOCALAPPDATA", saved.localAppData],
    ] as const) {
      if (value === undefined) {
        Reflect.deleteProperty(process.env, key)
      } else {
        process.env[key] = value
      }
    }
  })

  test("keeps the CLI out of the roaming profile on Windows", function () {
    setHost("win32", "C:\\Users\\student\\AppData\\Roaming", "C:\\Users\\student\\AppData\\Local")

    expect(cliFolder(context)).toBe(
      path.join("C:\\Users\\student\\AppData\\Local", "moocfi.test-my-code", "cli"),
    )
  })

  test("falls back to globalStorage when the local profile is unknown", function () {
    setHost("win32", "C:\\Users\\student\\AppData\\Roaming", undefined)

    expect(cliFolder(context)).toBe(legacyCliFolder(context))
  })

  test("falls back to globalStorage when it is not under the roaming profile", function () {
    setHost("win32", "D:\\Roaming", "D:\\Local")

    expect(cliFolder(context)).toBe(legacyCliFolder(context))
  })

  test("is under globalStorage everywhere else", function () {
    setHost("linux", "/ignored", "/ignored")

    expect(cliFolder(context)).toBe(path.join(roamingStorage, "cli"))
  })
})
