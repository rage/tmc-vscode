import { Err, Ok } from "ts-results"
import { vi } from "vitest"
import * as vscode from "vscode"

import { testExercise } from "../../actions/testExercise"
import type { ReadyActionContext, ReadyStartup } from "../../actions/types"
import { failure } from "../../api/withOperation"
import type { WorkspaceExercise } from "../../api/workspaceManager"
import { ExerciseStatus } from "../../api/workspaceManager"
import { runForExercise } from "../../commands/runForExercise"
import { BottleneckError } from "../../errors"
import { makeTmcKind } from "../../shared/shared"
import { createMockActionContext } from "../mocks/actionContext"

vi.mock("../../window", () => ({ resolvePythonInterpreter: () => undefined }))

const COURSE_SLUG = "python-course"
const EXERCISE_SLUG = "part01-01_hello"

function course(perhapsExamMode = false) {
  return makeTmcKind({
    id: 42,
    name: COURSE_SLUG,
    title: "Python Course",
    description: "",
    organization: "mooc",
    exercises: [
      {
        id: 1,
        name: EXERCISE_SLUG,
        availablePoints: 1,
        awardedPoints: 0,
        deadline: null,
        passed: false,
        softDeadline: null,
      },
    ],
    availablePoints: 1,
    awardedPoints: 0,
    perhapsExamMode,
    newExercises: [],
    notifyAfter: 0,
    disabled: false,
    materialUrl: null,
  })
}

const passingRun = { logs: {}, status: "PASSED", testResults: [] }
const noToken = new vscode.CancellationTokenSource().token

// A distinct path per test, so the single-flight key one test holds can't reject the next.
let exerciseCounter = 0
function workspaceExercise(): WorkspaceExercise {
  exerciseCounter += 1
  return {
    backend: "tmc",
    courseSlug: COURSE_SLUG,
    exerciseSlug: EXERCISE_SLUG,
    status: ExerciseStatus.Open,
    uri: vscode.Uri.file(`/exercises/${exerciseCounter}`),
  }
}

function contextWithTestRun(
  testRun: unknown,
  options: {
    checkstyleRun?: unknown
    testInterrupt?: () => void
    checkstyleInterrupt?: () => void
    examMode?: boolean
  } = {},
): ReadyActionContext {
  return createMockActionContext({
    startup: {
      langs: {
        runTests: vi.fn(() => ({
          process: Promise.resolve(testRun),
          interrupt: options.testInterrupt ?? vi.fn(),
        })),
        runCheckstyle: () => ({
          process: Promise.resolve(
            options.checkstyleRun ?? Ok({ strategy: "DISABLED", validation_errors: null }),
          ),
          interrupt: options.checkstyleInterrupt ?? vi.fn(),
        }),
      } as unknown as ReadyStartup["langs"],
      userData: {
        getCourseBySlug: () => Ok(course(options.examMode)),
      } as unknown as ReadyStartup["userData"],
    },
  })
}

suite("testExercise action", () => {
  test("hands back the test and code quality results", async () => {
    const validation = { strategy: "FAIL", validation_errors: {} }
    const actionContext = contextWithTestRun(Ok(passingRun), { checkstyleRun: Ok(validation) })

    const outcome = await testExercise(actionContext, workspaceExercise(), noToken)

    expect(outcome.ok && outcome.val).toEqual({
      kind: "ran",
      runResult: passingRun,
      styleValidation: Ok(validation),
      isCourseDisabled: false,
    })
  })

  test("a failed test run stops the code quality check running beside it", async () => {
    const checkstyleInterrupt = vi.fn()
    const actionContext = contextWithTestRun(Err(new Error("No compiler on PATH")), {
      checkstyleRun: new Promise(() => {}),
      checkstyleInterrupt,
    })

    const outcome = await testExercise(actionContext, workspaceExercise(), noToken)

    expect(outcome.err && outcome.val.message).toBe("No compiler on PATH")
    expect(checkstyleInterrupt).toHaveBeenCalledOnce()
  })

  test("a code quality check that fails to run keeps the test results", async () => {
    const actionContext = contextWithTestRun(Ok(passingRun), {
      checkstyleRun: Err(new Error("Checkstyle crashed")),
    })

    const outcome = await testExercise(actionContext, workspaceExercise(), noToken)

    expect(outcome.ok && outcome.val.kind === "ran" && outcome.val.runResult).toBe(passingRun)
    expect(outcome.ok && outcome.val.kind === "ran" && outcome.val.styleValidation.err).toBeTruthy()
  })

  test("cancelling stops both CLI processes", async () => {
    const testInterrupt = vi.fn()
    const checkstyleInterrupt = vi.fn()
    let finish!: (value: unknown) => void
    const actionContext = contextWithTestRun(
      new Promise((resolve) => {
        finish = resolve
      }),
      {
        testInterrupt,
        checkstyleInterrupt,
      },
    )
    const cancellation = new vscode.CancellationTokenSource()

    const running = testExercise(actionContext, workspaceExercise(), cancellation.token)
    await vi.waitFor(() => expect(actionContext.startup.langs.runTests).toHaveBeenCalled())
    cancellation.cancel()
    finish(Ok({ logs: {}, status: "TESTRUN_INTERRUPTED", testResults: [] }))
    await running

    expect(testInterrupt).toHaveBeenCalledOnce()
    expect(checkstyleInterrupt).toHaveBeenCalledOnce()
  })

  test("runs nothing in exam mode", async () => {
    const actionContext = contextWithTestRun(Ok(passingRun), { examMode: true })

    const outcome = await testExercise(actionContext, workspaceExercise(), noToken)

    expect(outcome.ok && outcome.val).toEqual({ kind: "examMode" })
    expect(actionContext.startup.langs.runTests).not.toHaveBeenCalled()
  })

  test("a second run of the same exercise is rejected as busy", async () => {
    let finish!: (value: unknown) => void
    const actionContext = contextWithTestRun(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    const exercise = workspaceExercise()

    const first = testExercise(actionContext, exercise, noToken)
    const second = await testExercise(actionContext, exercise, noToken)
    finish(Ok(passingRun))
    await first

    expect(second.err && second.val).toBeInstanceOf(BottleneckError)
  })
})

// Drives the action through the real `runForExercise`/`withOperation` boundary to prove
// the busy notice is shown exactly once, as information rather than an error.
suite("testExercise action, through the real runForExercise boundary", () => {
  function testBody(actionContext: ReadyActionContext) {
    return (exercise: WorkspaceExercise) =>
      testExercise(actionContext, exercise, noToken).then((result) =>
        result.err ? failure("Exercise test run failed.", result.val) : Ok.EMPTY,
      )
  }

  test("a busy rejection notifies exactly once and reports no error", async () => {
    let finishTest!: () => void
    const running = new Promise((resolve) => {
      finishTest = () => resolve(Ok(passingRun))
    })
    const exercise = workspaceExercise()
    const base = contextWithTestRun(running)
    const actionContext: ReadyActionContext = {
      ...base,
      startup: {
        ...base.startup,
        workspaceManager: {
          get activeExercise() {
            return exercise
          },
          getExerciseContaining: () => exercise,
        } as unknown as ReadyStartup["workspaceManager"],
      },
    }
    const notification = vi.mocked(actionContext.dialog.notification)
    const reportError = vi.mocked(actionContext.dialog.reportError)

    const first = runForExercise(
      actionContext,
      undefined,
      "Testing the exercise",
      testBody(actionContext),
    )
    const second = await runForExercise(
      actionContext,
      undefined,
      "Testing the exercise",
      testBody(actionContext),
    )

    expect(second.err).toBe(true)
    expect(notification).toHaveBeenCalledExactlyOnceWith(
      "Tests are already running for this exercise.",
    )
    expect(reportError).not.toHaveBeenCalled()

    finishTest()
    await first
  })
})
