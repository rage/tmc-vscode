import * as fs from "fs"
import * as os from "os"
import * as path from "path"

import type { TestResult } from "../../shared/langsSchema"
import { createSourceFileFinder } from "../../testing/sourceFiles"
import { parseStackTrace } from "../../testing/stackTrace"
import { failureMessage } from "../../testing/testMessages"

function failed(message: string, exception: string[]): TestResult {
  return { name: "t", successful: false, points: [], message, exception }
}

suite("stack traces of failed tests", function () {
  let exercisePath: string

  beforeEach(function () {
    exercisePath = fs.mkdtempSync(path.join(os.tmpdir(), "r3-stack-"))
  })

  afterEach(function () {
    fs.rmSync(exercisePath, { recursive: true, force: true })
  })

  function writeSource(relativePath: string): string {
    const file = path.join(exercisePath, relativePath)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, "\n")
    return file
  }

  test("Python frames come innermost first, without their source lines", async function () {
    const test = path.join(exercisePath, "test", "test_hello.py")
    const source = path.join(exercisePath, "src", "hello.py")

    const { frames, details } = await parseStackTrace(
      [
        `  File "${test}", line 12, in test_first\n    self.assertEqual(hello(), 1)\n`,
        `  File "${source}", line 3, in hello\n    return 1 / 0\n`,
      ],
      exercisePath,
    )

    expect(frames).toEqual([
      { label: "hello", file: source, line: 3 },
      { label: "test_first", file: test, line: 12 },
    ])
    expect(details).toEqual([])
  })

  test("tmc-langs' Java frames resolve through the package to the source root", async function () {
    const source = writeSource("src/main/java/fi/helsinki/Hello.java")

    const { frames, details } = await parseStackTrace(
      [
        "java.lang.ArithmeticException: / by zero",
        "Hello.java:7: fi.helsinki.Hello.divide",
        "Assert.java:88: org.junit.Assert.fail",
        "-2: jdk.internal.reflect.NativeMethodAccessorImpl.invoke0",
      ],
      exercisePath,
    )

    expect(frames).toEqual([
      { label: "fi.helsinki.Hello.divide", file: source, line: 7 },
      { label: "org.junit.Assert.fail" },
      { label: "jdk.internal.reflect.NativeMethodAccessorImpl.invoke0" },
    ])
    expect(details).toEqual(["java.lang.ArithmeticException: / by zero"])
  })

  test("Java's own `at` frames resolve too, and an inner class to its file", async function () {
    const source = writeSource("src/Hello.java")

    const { frames } = await parseStackTrace(["\tat Hello$Inner.run(Hello.java:4)"], exercisePath)

    expect(frames).toEqual([{ label: "Hello$Inner.run", file: source, line: 4 }])
  })

  test("never looks for the JDK's or a test framework's classes in the exercise", async function () {
    const findFile = vi.fn(createSourceFileFinder(exercisePath))

    await parseStackTrace(
      [
        "\tat Hello.a(Hello.java:4)",
        "\tat org.junit.Assert.fail(Assert.java:89)",
        "\tat java.base/java.lang.Thread.run(Thread.java:1583)",
      ],
      exercisePath,
      findFile,
    )

    expect(findFile.mock.calls).toEqual([["Hello.java"]])
  })

  test("a source file finder checks the disk once per file", async function () {
    const source = writeSource("src/Hello.java")
    const access = vi.spyOn(fs.promises, "access")
    const findFile = createSourceFileFinder(exercisePath)

    expect(await findFile("Hello.java")).toBe(source)
    const probes = access.mock.calls.length
    expect(probes).toBeGreaterThan(0)
    expect(await findFile("Hello.java")).toBe(source)

    expect(access).toHaveBeenCalledTimes(probes)
    access.mockRestore()
  })

  test("lines of an unknown format are kept as details", async function () {
    const { frames, details } = await parseStackTrace(["Segmentation fault", ""], exercisePath)

    expect(frames).toEqual([])
    expect(details).toEqual(["Segmentation fault"])
  })

  test("a failure is located at the innermost frame in the exercise, skipping tmc helpers", async function () {
    const test = path.join(exercisePath, "test", "test_hello.py")
    const helper = path.join(exercisePath, "tmc", "utils.py")

    const message = await failureMessage(
      failed("wrong", [
        `  File "${test}", line 9, in test_first\n`,
        `  File "${helper}", line 20, in check\n`,
        `  File "/usr/lib/python3.12/unittest/case.py", line 5, in fail\n`,
      ]),
      exercisePath,
    )

    expect(message.message).toBe("wrong")
    expect(message.location?.uri.fsPath).toBe(test)
    expect(message.location?.range.start.line).toBe(8)
    expect(message.stackTrace?.map((frame) => frame.label)).toEqual(["fail", "check", "test_first"])
  })

  test("a JUnit comparison becomes a diff", async function () {
    const message = await failureMessage(
      failed("expected:<3> but was:<4>", ["expected:<3> but was:<4>"]),
      exercisePath,
    )

    expect(message.expectedOutput).toBe("3")
    expect(message.actualOutput).toBe("4")
  })

  test("a failure without a message falls back to the exception text, then a default", async function () {
    const withException = await failureMessage(failed("", ["Boom"]), exercisePath)
    const bare = await failureMessage(failed("", []), exercisePath)

    expect(withException.message).toBe("Boom")
    expect(bare.message).toBe("The test failed.")
    expect(bare.location).toBeUndefined()
  })
})
