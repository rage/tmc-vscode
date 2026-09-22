import { Err, Ok } from "ts-results"
import { vi } from "vitest"
import type * as vscode from "vscode"

import type { ReadyActionContext, ReadyStartup } from "../../actions/types"
import { testExercise } from "../../actions/user"
import type { WorkspaceExercise } from "../../api/workspaceManager"
import { ExerciseStatus } from "../../api/workspaceManager"
import { makeTmcKind } from "../../shared/shared"
import { createMockActionContext } from "../mocks/actionContext"

// TmcPanel talks to the vscode webview API, so the whole module is mocked; the
// action only needs renderSide (a no-op), postMessage (asserted), and a defined
// sidePanel so the re-render branch is skipped.
vi.mock("../../panels/TmcPanel", () => ({
  nextPanelId: () => 1,
  TmcPanel: {
    renderSide: vi.fn(),
    postMessage: vi.fn(),
    sidePanel: {},
  },
}))

import { TmcPanel } from "../../panels/TmcPanel"

const COURSE_SLUG = "python-course"
const EXERCISE_SLUG = "part01-01_hello"

const course = makeTmcKind({
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
  perhapsExamMode: false,
  newExercises: [],
  notifyAfter: 0,
  disabled: false,
  materialUrl: null,
})

const extensionContext = { extensionUri: {} } as unknown as vscode.ExtensionContext

// A distinct path per test, so the single-flight key one test holds can't reject the next.
let exerciseCounter = 0
function workspaceExercise(): WorkspaceExercise {
  exerciseCounter += 1
  return {
    backend: "tmc",
    courseSlug: COURSE_SLUG,
    exerciseSlug: EXERCISE_SLUG,
    status: ExerciseStatus.Open,
    uri: { fsPath: `/exercises/${exerciseCounter}` } as unknown as vscode.Uri,
  }
}

function contextWithTestRun(
  testRun: unknown,
  checkstyleRun: unknown = Ok({ strategy: "DISABLED", validation_errors: null }),
): ReadyActionContext {
  return createMockActionContext({
    startup: {
      langs: {
        runTests: () => ({ process: Promise.resolve(testRun), interrupt: vi.fn() }),
        runCheckstyle: () => ({ process: Promise.resolve(checkstyleRun), interrupt: vi.fn() }),
      } as unknown as ReadyStartup["langs"],
      userData: {
        getCourseBySlug: () => Ok(course),
      } as unknown as ReadyStartup["userData"],
    },
  })
}

suite("testExercise action", () => {
  test("a failed test run survives the webview boundary with its message intact", async () => {
    // The panel reads `error.message`, and the webview bridge serializes the message
    // as JSON -- which drops a live Error's non-enumerable `message`.
    const actionContext = contextWithTestRun(Err(new Error("No compiler on PATH")))

    await testExercise(extensionContext, actionContext, workspaceExercise())

    const posted = vi
      .mocked(TmcPanel.postMessage)
      .mock.calls.flat()
      .find((message) => message.type === "testError")
    expect(posted).toBeDefined()
    const delivered = JSON.parse(JSON.stringify(posted)) as { error: { message: string } }
    expect(delivered.error.message).toBe("No compiler on PATH")
  })

  test("a failed style validation reaches the panel the same way", async () => {
    const actionContext = contextWithTestRun(
      Ok({ logs: {}, status: "PASSED", testResults: [] }),
      Err(new Error("Checkstyle crashed")),
    )

    await testExercise(extensionContext, actionContext, workspaceExercise())

    const posted = vi
      .mocked(TmcPanel.postMessage)
      .mock.calls.flat()
      .find((message) => message.type === "testError")
    const delivered = JSON.parse(JSON.stringify(posted)) as { error: { message: string } }
    expect(delivered.error.message).toBe("Checkstyle crashed")
  })
})
