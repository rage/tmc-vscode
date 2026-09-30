import * as fs from "fs"
import * as os from "os"
import * as path from "path"

import { Err, Ok } from "ts-results"
import { vi } from "vitest"
import * as vscode from "vscode"

import type { ReadyActionContext, ReadyStartup } from "../../actions/types"
import type WorkspaceManager from "../../api/workspaceManager"
import type { WorkspaceExercise } from "../../api/workspaceManager"
import { ExerciseStatus } from "../../api/workspaceManager"
import { BottleneckError } from "../../errors"
import type { RunResult, StyleValidationResult } from "../../shared/langsSchema"
import { BaseError, ExerciseIdentifier } from "../../shared/shared"
import { CheckstyleDiagnostics } from "../../testing/checkstyleDiagnostics"
import { ExerciseTestController } from "../../testing/exerciseTestController"
import { exerciseOperations } from "../../ui/exerciseOperations"
import { tmcCourseExercise, tmcLocalCourse } from "../fixtures/courses"
import { createMockActionContext } from "../mocks/actionContext"
import { createDialogMock } from "../mocks/dialog"

vi.mock("../../window", () => ({ resolvePythonInterpreter: () => undefined }))

const COURSE_SLUG = "python-course"

type Reported = [state: string, itemId: string, message?: vscode.TestMessage | vscode.TestMessage[]]

interface FakeTestItem extends vscode.TestItem {
  children: vscode.TestItemCollection & { size: number }
}

interface FakeTestRun {
  name: string | undefined
  results: Reported[]
  output: { output: string; test?: vscode.TestItem }[]
  ended: boolean
  cancel: () => void
}

interface FakeTestController {
  items: vscode.TestItemCollection & { size: number }
  profiles: { label: string; isDefault: boolean; runHandler: vscode.TestRunProfile["runHandler"] }[]
  runs: FakeTestRun[]
}

function course(options: {
  examMode?: boolean | undefined
  disabled?: boolean | undefined
  slugs: string[]
}) {
  return tmcLocalCourse({
    name: COURSE_SLUG,
    exercises: options.slugs.map((name, index) => tmcCourseExercise({ id: index + 1, name })),
    availablePoints: 1,
    perhapsExamMode: options.examMode ?? false,
    disabled: options.disabled ?? false,
  })
}

const passingRun: RunResult = {
  status: "PASSED",
  logs: { stdout: "Hello\nWorld\n", stderr: "" },
  testResults: [
    {
      name: "test.test_hello.Hello.test_first",
      successful: true,
      points: ["1.1"],
      message: "",
      exception: [],
    },
    {
      name: "test.test_hello.Hello.test_second",
      successful: true,
      points: ["1.2"],
      message: "",
      exception: [],
    },
  ],
}

interface Setup {
  controller: ExerciseTestController
  fake: FakeTestController
  actionContext: ReadyActionContext
  exercises: WorkspaceExercise[]
  runTests: ReturnType<typeof vi.fn>
  interrupts: ReturnType<typeof vi.fn>[]
  diagnostics: CheckstyleDiagnostics
}

let tempDir: string

beforeEach(function () {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "r3-controller-"))
})

afterEach(function () {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

function setup(
  options: {
    run?: Promise<unknown> | unknown
    checkstyle?: StyleValidationResult | Error
    examMode?: boolean
    disabled?: boolean
    loggedIn?: boolean
    slugs?: string[]
    closedSlugs?: string[]
  } = {},
): Setup {
  const slugs = options.slugs ?? ["part01-01_hello"]
  const exercises: WorkspaceExercise[] = [...slugs, ...(options.closedSlugs ?? [])].map((slug) => ({
    backend: "tmc",
    courseSlug: COURSE_SLUG,
    exerciseSlug: slug,
    status: slugs.includes(slug) ? ExerciseStatus.Open : ExerciseStatus.Closed,
    uri: vscode.Uri.file(path.join(tempDir, slug)),
  }))
  const interrupts: ReturnType<typeof vi.fn>[] = []
  const runTests = vi.fn(() => {
    const interrupt = vi.fn()
    interrupts.push(interrupt)
    return { process: Promise.resolve(options.run ?? Ok(passingRun)), interrupt }
  })
  const checkstyle = options.checkstyle ?? { strategy: "DISABLED", validation_errors: null }
  const [dialog] = createDialogMock()
  const actionContext: ReadyActionContext = {
    ...createMockActionContext({
      authenticated: { tmc: options.loggedIn ?? true, mooc: options.loggedIn ?? true },
      startup: {
        langs: {
          runTests,
          runCheckstyle: () => {
            const interrupt = vi.fn()
            interrupts.push(interrupt)
            return {
              process: Promise.resolve(
                checkstyle instanceof Error ? Err(checkstyle) : Ok(checkstyle),
              ),
              interrupt,
            }
          },
        } as unknown as ReadyStartup["langs"],
        userData: {
          getCourseBySlug: () =>
            Ok(course({ examMode: options.examMode, disabled: options.disabled, slugs })),
        } as unknown as ReadyStartup["userData"],
        workspaceManager: {
          activeCourse: COURSE_SLUG,
          activeCourseBackend: "tmc",
          getExercisesByCourseSlug: () => exercises,
        } as unknown as WorkspaceManager,
      },
    }),
    dialog,
  }
  const diagnostics = new CheckstyleDiagnostics(
    vscode.languages.createDiagnosticCollection("tmc-checkstyle"),
  )
  const controller = new ExerciseTestController(actionContext, diagnostics)
  const fake = vi.mocked(vscode.tests.createTestController).mock.results.at(-1)
    ?.value as FakeTestController
  return { controller, fake, actionContext, exercises, runTests, interrupts, diagnostics }
}

function exerciseAt(s: Setup, index = 0): WorkspaceExercise {
  const exercise = s.exercises[index]
  if (!exercise) {
    throw new Error(`no exercise ${index}`)
  }
  return exercise
}

function itemOf(s: Setup, exercise: WorkspaceExercise): FakeTestItem {
  const item = s.fake.items.get(exercise.uri.toString())
  if (!item) {
    throw new Error(`no item for ${exercise.exerciseSlug}`)
  }
  return item as FakeTestItem
}

function lastRun(s: Setup): FakeTestRun {
  const run = s.fake.runs.at(-1)
  if (!run) {
    throw new Error("no run")
  }
  return run
}

function finalStates(run: FakeTestRun): Map<string, Reported> {
  return new Map(
    run.results
      .filter(([state]) => state !== "enqueued" && state !== "started")
      .map((reported) => [reported[1], reported]),
  )
}

function messagesOf(reported: Reported | undefined): vscode.TestMessage[] {
  const message = reported?.[2]
  return message === undefined ? [] : Array.isArray(message) ? message : [message]
}

suite("ExerciseTestController", function () {
  test("has one item per exercise open in the course workspace and a default run profile", function () {
    const s = setup({ slugs: ["a", "b"], closedSlugs: ["c"] })

    const labels: string[] = []
    s.fake.items.forEach((item) => void labels.push(item.label))
    expect(labels.toSorted()).toEqual(["a", "b"])
    expect(itemOf(s, exerciseAt(s)).uri?.fsPath).toBe(exerciseAt(s).uri.fsPath)
    expect(s.fake.profiles).toEqual([
      expect.objectContaining({ label: "Run Tests", isDefault: true }),
    ])
  })

  test("re-syncing keeps an exercise's item and the tests found under it", async function () {
    const s = setup()
    await s.controller.runExercise(exerciseAt(s))
    const item = itemOf(s, exerciseAt(s))

    s.controller.syncExercises()

    expect(itemOf(s, exerciseAt(s))).toBe(item)
    expect(item.children.size).toBe(2)
  })

  test("a passing run reports each test, the exercise, its output and offers Submit", async function () {
    const s = setup()
    const exercise = exerciseAt(s)

    const result = await s.controller.runExercise(exercise)

    expect(result.ok).toBe(true)
    const run = lastRun(s)
    expect(run.ended).toBe(true)
    expect(run.name).toBe("part01-01_hello")
    const item = itemOf(s, exercise)
    const states = finalStates(run)
    expect(states.get(item.id)?.[0]).toBe("passed")
    item.children.forEach((child) => expect(states.get(child.id)?.[0]).toBe("passed"))
    expect(item.description).toBe("2/2 tests passed")
    expect(run.output).toEqual([{ output: "stdout:\r\nHello\r\nWorld\r\n\r\n", test: item }])

    expect(s.actionContext.dialog.notification).toHaveBeenCalledOnce()
    const [message, [label, onSubmit]] = vi.mocked(s.actionContext.dialog.notification).mock
      .calls[0] as unknown as [string, [string, () => void]]
    expect(message).toBe("All tests of part01-01_hello passed.")
    expect(label).toBe("Submit")
    const executeCommand = vi.spyOn(vscode.commands, "executeCommand").mockResolvedValue(undefined)
    onSubmit()
    expect(executeCommand).toHaveBeenCalledWith("tmc.submitExercise", exercise.uri)
    executeCommand.mockRestore()
  })

  test("a failing test is reported at its stack frame, and Submit is not offered", async function () {
    const testFile = path.join(tempDir, "part01-01_hello", "test", "test_hello.py")
    const s = setup({
      run: Ok({
        status: "TESTS_FAILED",
        logs: {},
        testResults: [
          passingRun.testResults[0],
          {
            name: "test.test_hello.Hello.test_second",
            successful: false,
            points: [],
            message: "'Hi' != 'Hello'",
            exception: [
              `  File "${testFile}", line 12, in test_second\n    self.assertEqual(greet(), "Hello")\n`,
            ],
          },
        ],
      }),
    })
    const exercise = exerciseAt(s)

    await s.controller.runExercise(exercise)

    const item = itemOf(s, exercise)
    const states = finalStates(lastRun(s))
    const failedChild = item.children.get(`${item.id}/test.test_hello.Hello.test_second`)
    const [failure] = messagesOf(states.get(failedChild?.id ?? ""))
    expect(failure?.message).toBe("'Hi' != 'Hello'")
    expect(failure?.location?.uri.fsPath).toBe(testFile)
    expect(failure?.location?.range.start.line).toBe(11)
    expect(states.get(item.id)?.[0]).toBe("failed")
    expect(messagesOf(states.get(item.id)).map((m) => m.message)).toEqual(["1 of 2 tests failed."])
    expect(item.description).toBe("1/2 tests passed")
    expect(s.actionContext.dialog.notification).not.toHaveBeenCalled()
  })

  test("marks the exercise as being tested while the run lasts", async function () {
    const s = setup()
    const exercise = exerciseAt(s)
    let during: unknown
    s.runTests.mockImplementation(() => {
      during = exerciseOperations.current(ExerciseIdentifier.from(1))
      return { process: Promise.resolve(Ok(passingRun)), interrupt: vi.fn() }
    })

    await s.controller.runExercise(exercise)

    expect(during).toBe("testing")
    expect(exerciseOperations.current(ExerciseIdentifier.from(1))).toBeUndefined()
  })

  test("running one test runs its whole exercise once", async function () {
    const s = setup()
    await s.controller.runExercise(exerciseAt(s))
    const item = itemOf(s, exerciseAt(s))
    const [, child] = [...item.children][0] as [string, vscode.TestItem]
    s.runTests.mockClear()

    const [profile] = s.fake.profiles
    await profile?.runHandler(
      new vscode.TestRunRequest([child, item]),
      new vscode.CancellationTokenSource().token,
    )

    expect(s.runTests).toHaveBeenCalledExactlyOnceWith(exerciseAt(s).uri.fsPath, undefined)
  })

  test("a compile failure marks the exercise errored with the compiler output", async function () {
    const s = setup({
      run: Ok({
        status: "COMPILE_FAILED",
        logs: { stdout: "", stderr: "Hello.java:3: error: ';' expected" },
        testResults: [],
      }),
    })

    await s.controller.runExercise(exerciseAt(s))

    const reported = finalStates(lastRun(s)).get(itemOf(s, exerciseAt(s)).id)
    expect(reported?.[0]).toBe("errored")
    expect(messagesOf(reported)[0]?.message).toBe(
      "The exercise did not compile.\n\nHello.java:3: error: ';' expected",
    )
  })

  test("a run the CLI could not start is errored with the error's details", async function () {
    const s = setup({ run: Err(new BaseError("No Python found", "python3: not found")) })

    await s.controller.runExercise(exerciseAt(s))

    const reported = finalStates(lastRun(s)).get(itemOf(s, exerciseAt(s)).id)
    expect(reported?.[0]).toBe("errored")
    expect(messagesOf(reported)[0]?.message).toBe(
      "The tests could not be run: No Python found\n\npython3: not found",
    )
  })

  test("exam mode skips the exercise, says why and offers Submit", async function () {
    const s = setup({ examMode: true })

    await s.controller.runExercise(exerciseAt(s))

    const run = lastRun(s)
    expect(finalStates(run).get(itemOf(s, exerciseAt(s)).id)?.[0]).toBe("skipped")
    expect(run.output[0]?.output).toContain("not run locally in exam mode")
    expect(s.runTests).not.toHaveBeenCalled()
    expect(s.actionContext.dialog.notification).toHaveBeenCalledExactlyOnceWith(
      "Tests are not run locally in exam mode.",
      ["Submit", expect.any(Function)],
    )
  })

  test("code quality problems fail an otherwise passing exercise and show as diagnostics", async function () {
    const source = path.join(tempDir, "part01-01_hello", "src", "Hello.java")
    fs.mkdirSync(path.dirname(source), { recursive: true })
    fs.writeFileSync(source, "class Hello {}\n")
    const s = setup({
      checkstyle: {
        strategy: "FAIL",
        validation_errors: {
          "Hello.java": [
            {
              line: 1,
              column: 1,
              message: "Missing a Javadoc comment.",
              source_name: "x.JavadocCheck",
            },
          ],
        },
      },
    })

    await s.controller.runExercise(exerciseAt(s))

    const reported = finalStates(lastRun(s)).get(itemOf(s, exerciseAt(s)).id)
    expect(reported?.[0]).toBe("failed")
    expect(messagesOf(reported)[0]?.message).toMatch(/found 1 problem\. /)
    const collection = vi.mocked(vscode.languages.createDiagnosticCollection).mock.results.at(-1)
      ?.value as vscode.DiagnosticCollection
    expect(collection.get(vscode.Uri.file(source))).toHaveLength(1)
    expect(s.actionContext.dialog.notification).not.toHaveBeenCalled()
  })

  test("a code quality check that fails to run is noted in the output, not failed", async function () {
    const s = setup({ checkstyle: new Error("Checkstyle crashed") })

    await s.controller.runExercise(exerciseAt(s))

    const run = lastRun(s)
    expect(finalStates(run).get(itemOf(s, exerciseAt(s)).id)?.[0]).toBe("passed")
    expect(run.output.map(({ output }) => output)).toContain(
      "Code quality checks could not be run: Checkstyle crashed\r\n",
    )
  })

  test("cancelling the run stops the CLI and skips the exercise", async function () {
    let finish!: (value: unknown) => void
    const s = setup({
      run: new Promise((resolve) => {
        finish = resolve
      }),
    })

    const running = s.controller.runExercise(exerciseAt(s))
    await vi.waitFor(() => expect(s.interrupts).toHaveLength(2))
    lastRun(s).cancel()
    for (const interrupt of s.interrupts) {
      expect(interrupt).toHaveBeenCalled()
    }
    finish(Ok({ status: "TESTRUN_INTERRUPTED", logs: {}, testResults: [] }))
    await running

    expect(finalStates(lastRun(s)).get(itemOf(s, exerciseAt(s)).id)?.[0]).toBe("skipped")
  })

  test("a second run of a busy exercise is skipped and handed back as busy", async function () {
    let finish!: (value: unknown) => void
    const s = setup({
      run: new Promise((resolve) => {
        finish = resolve
      }),
    })

    const first = s.controller.runExercise(exerciseAt(s))
    const second = await s.controller.runExercise(exerciseAt(s))
    finish(Ok(passingRun))
    await first

    expect(second.err && second.val).toBeInstanceOf(BottleneckError)
    expect(finalStates(s.fake.runs[1] as FakeTestRun).get(itemOf(s, exerciseAt(s)).id)?.[0]).toBe(
      "skipped",
    )
  })

  test("Submit is not offered for a disabled course, when logged out, or for several exercises", async function () {
    const disabled = setup({ disabled: true })
    await disabled.controller.runExercise(exerciseAt(disabled))
    expect(disabled.actionContext.dialog.notification).not.toHaveBeenCalled()

    const loggedOut = setup({ loggedIn: false })
    await loggedOut.controller.runExercise(exerciseAt(loggedOut))
    expect(loggedOut.actionContext.dialog.notification).not.toHaveBeenCalled()

    const several = setup({ slugs: ["a", "b"] })
    await several.fake.profiles[0]?.runHandler(
      new vscode.TestRunRequest(),
      new vscode.CancellationTokenSource().token,
    )
    expect(several.runTests).toHaveBeenCalledTimes(2)
    expect(several.actionContext.dialog.notification).not.toHaveBeenCalled()
  })

  test("a test's exercise folder is found through its parent", async function () {
    const s = setup()
    await s.controller.runExercise(exerciseAt(s))
    const item = itemOf(s, exerciseAt(s))
    const [, child] = [...item.children][0] as [string, vscode.TestItem]

    expect(s.controller.exerciseUriOf(child)).toBe(exerciseAt(s).uri)
    expect(s.controller.exerciseUriOf(undefined)).toBeUndefined()
  })
})
