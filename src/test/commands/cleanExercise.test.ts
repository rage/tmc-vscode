import * as path from "path"

import { Ok } from "ts-results"
import * as vscode from "vscode"

import type { ActionContext } from "../../actions/types"
import type Langs from "../../api/langs"
import type WorkspaceManager from "../../api/workspaceManager"
import { ExerciseStatus } from "../../api/workspaceManager"
import { cleanExercise } from "../../commands"
import { createMockActionContext } from "../mocks/actionContext"
import { createTMCMock } from "../mocks/tmc"
import type { WorkspaceManagerMockValues } from "../mocks/workspaceManager"
import { createWorkspaceMangerMock } from "../mocks/workspaceManager"

suite("Clean exercise command", function () {
  const BACKEND_FOLDER = path.join(__dirname, "..", "backend")
  const COURSE_PATH = path.join(BACKEND_FOLDER, "resources", "test-python-course")
  const PASSING_EXERCISE_PATH = path.join(COURSE_PATH, "part01-01_passing_exercise")

  const uri = vscode.Uri.file(PASSING_EXERCISE_PATH)
  const exercise = {
    backend: "tmc" as const,
    courseSlug: "test-python-course",
    exerciseSlug: "part01-01_passing_exercise",
    status: ExerciseStatus.Open,
    uri,
  }

  let stubContext: ActionContext
  let tmcMock: Langs
  let workspaceManagerMock: WorkspaceManager
  let workspaceManagerMockValues: WorkspaceManagerMockValues

  function actionContext(): ActionContext {
    return {
      ...stubContext,
      langs: new Ok(tmcMock),
      workspaceManager: new Ok(workspaceManagerMock),
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
})
