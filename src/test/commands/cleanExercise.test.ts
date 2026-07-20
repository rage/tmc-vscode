import * as path from "path"

import { Ok } from "ts-results"
import type { IMock } from "typemoq"
import { It, Times } from "typemoq"
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

  const stubContext = createMockActionContext()
  const uri = vscode.Uri.file(PASSING_EXERCISE_PATH)

  let tmcMock: IMock<Langs>
  let workspaceManagerMock: IMock<WorkspaceManager>
  let workspaceManagerMockValues: WorkspaceManagerMockValues

  function actionContext(): ActionContext {
    return {
      ...stubContext,
      langs: new Ok(tmcMock.object),
      workspaceManager: new Ok(workspaceManagerMock.object),
    }
  }

  setup(function () {
    ;[tmcMock] = createTMCMock()
    ;[workspaceManagerMock, workspaceManagerMockValues] = createWorkspaceMangerMock()
  })

  test("should clean active exercise by default", async function () {
    workspaceManagerMockValues.activeExercise = {
      backend: "tmc",
      courseSlug: "test-python-course",
      exerciseSlug: "part01-01_passing_exercise",
      status: ExerciseStatus.Open,
      uri,
    }
    await cleanExercise(actionContext(), undefined)
    tmcMock.verify((x) => x.clean(It.isValue(uri.fsPath)), Times.once())
  })

  test("should not clean active non-exercise", async function () {
    await cleanExercise(actionContext(), undefined)
    tmcMock.verify((x) => x.clean(It.isAny()), Times.never())
  })

  test("should clean provided exercise", async function () {
    await cleanExercise(actionContext(), uri)
    tmcMock.verify((x) => x.clean(It.isValue(uri.fsPath)), Times.once())
  })

  test("should not clean provided non-exercise", async function () {
    workspaceManagerMockValues.uriIsExercise = false
    await cleanExercise(actionContext(), uri)
    tmcMock.verify((x) => x.clean(It.isAny()), Times.never())
  })
})
