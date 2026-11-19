import * as path from "path"

import { vi } from "vitest"
import * as vscode from "vscode"

import type { ReadyActionContext } from "../../actions/types"
import type Langs from "../../api/langs"
import type WorkspaceManager from "../../api/workspaceManager"
import { ExerciseStatus } from "../../api/workspaceManager"
import { cleanExercise } from "../../commands"
import { WorkspaceUntrustedError } from "../../errors"
import { idOfTmcCourse, idOfTmcExercise } from "../fixtures/identifiers"
import { createMockActionContext } from "../mocks/actionContext"
import { createTMCMock } from "../mocks/tmc"
import type { WorkspaceManagerMockValues } from "../mocks/workspaceManager"
import { createWorkspaceMangerMock } from "../mocks/workspaceManager"
import { restrictedTrustGate } from "../support/trustGate"

suite("Clean exercise command", function () {
  const BACKEND_FOLDER = path.join(__dirname, "..", "backend")
  const COURSE_PATH = path.join(BACKEND_FOLDER, "resources", "test-python-course")
  const PASSING_EXERCISE_PATH = path.join(COURSE_PATH, "part01-01_passing_exercise")

  const uri = vscode.Uri.file(PASSING_EXERCISE_PATH)
  const exercise = {
    id: idOfTmcExercise(1),
    courseId: idOfTmcCourse(1),
    backend: "tmc" as const,
    courseSlug: "test-python-course",
    exerciseSlug: "part01-01_passing_exercise",
    status: ExerciseStatus.Open,
    uri,
  }

  let stubContext: ReadyActionContext
  let tmcMock: Langs
  let workspaceManagerMock: WorkspaceManager
  let workspaceManagerMockValues: WorkspaceManagerMockValues

  function actionContext(): ReadyActionContext {
    return {
      ...stubContext,
      startup: {
        ...stubContext.startup,
        langs: tmcMock,
        workspaceManager: workspaceManagerMock,
      },
    }
  }

  beforeEach(function () {
    stubContext = createMockActionContext()
    ;[tmcMock] = createTMCMock()
    ;[workspaceManagerMock, workspaceManagerMockValues] = createWorkspaceMangerMock()
  })

  test("should clean active exercise by default", async function () {
    workspaceManagerMockValues.activeExercise = exercise
    await cleanExercise(actionContext(), undefined)
    expect(tmcMock.clean).toHaveBeenCalledExactlyOnceWith(uri.fsPath)
  })

  // Cleaning runs the exercise's build tool, e.g. `make clean`.
  test("cleans nothing in Restricted Mode, and offers to trust the workspace", async function () {
    workspaceManagerMockValues.activeExercise = exercise
    const context = actionContext()
    context.startup.trustGate = restrictedTrustGate().trustGate

    await cleanExercise(context, undefined)

    expect(tmcMock.clean).not.toHaveBeenCalled()
    expect(context.dialog.reportError).toHaveBeenCalledWith(
      "Cleaning the exercise failed.",
      expect.any(WorkspaceUntrustedError),
    )
  })

  test("cleans the exercise once the workspace is trusted", async function () {
    workspaceManagerMockValues.activeExercise = exercise
    const context = actionContext()
    const { trustGate, retries } = restrictedTrustGate()
    context.startup.trustGate = trustGate
    const executeCommand = vi.spyOn(vscode.commands, "executeCommand").mockResolvedValue(undefined)

    await cleanExercise(context, undefined)
    retries.at(-1)?.()

    expect(executeCommand).toHaveBeenCalledWith("tmc.cleanExercise", uri)
  })

  test("should tell the user when no exercise is active", async function () {
    await cleanExercise(actionContext(), undefined)
    expect(tmcMock.clean).not.toHaveBeenCalled()
    expect(stubContext.dialog.errorNotification).toHaveBeenCalledOnce()
  })

  test("should clean provided exercise", async function () {
    workspaceManagerMockValues.getExerciseByPath = exercise
    await cleanExercise(actionContext(), uri)
    expect(tmcMock.clean).toHaveBeenCalledExactlyOnceWith(uri.fsPath)
  })

  test("should tell the user when the provided path is not an exercise", async function () {
    await cleanExercise(actionContext(), uri)
    expect(tmcMock.clean).not.toHaveBeenCalled()
    expect(stubContext.dialog.errorNotification).toHaveBeenCalledOnce()
  })

  test("should not clean a path outside the provided exercise", async function () {
    workspaceManagerMockValues.getExerciseByPath = exercise
    const outsideUri = vscode.Uri.file(path.join(COURSE_PATH, "part01-02_other_exercise"))
    await cleanExercise(actionContext(), outsideUri)
    expect(tmcMock.clean).not.toHaveBeenCalled()
    expect(stubContext.dialog.errorNotification).toHaveBeenCalledOnce()
  })
})
