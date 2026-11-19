import { Err, Ok } from "ts-results"
import { vi } from "vitest"
import * as vscode from "vscode"

import { downloadCourseExercises } from "../../actions/downloadCourseExercises"
import type WorkspaceManager from "../../api/workspaceManager"
import { ExerciseStatus } from "../../api/workspaceManager"
import { downloadExercisesOfCourse } from "../../commands/downloadExercisesOfCourse"
import type { UserData } from "../../config/userdata"
import { tmcCourseExercise, tmcLocalCourse } from "../fixtures/courses"
import { idOfTmcCourse, idOfTmcExercise } from "../fixtures/identifiers"
import { createMockActionContext } from "../mocks/actionContext"
import { createDialogMock } from "../mocks/dialog"

vi.mock("../../actions/downloadCourseExercises", () => ({
  downloadCourseExercises: vi.fn(async () => Ok({ warnings: [] })),
}))

const course = tmcLocalCourse({
  exercises: [
    tmcCourseExercise({ id: 1, name: "part01-01_hello" }),
    tmcCourseExercise({ id: 2, name: "part01-02_world" }),
  ],
})

function harness(onDisk: number[] = []): ReturnType<typeof createMockActionContext> {
  const userData = {
    getCourses: () => [course],
    getCourse: () => Ok(course),
  } as unknown as UserData
  const workspaceManager = {
    getExercises: () =>
      onDisk.map((id) => ({
        id: idOfTmcExercise(id),
        courseId: idOfTmcCourse(42),
        status: ExerciseStatus.Open,
        uri: vscode.Uri.file(`/exercises/${id}`),
      })),
  } as unknown as WorkspaceManager
  return {
    ...createMockActionContext({ startup: { userData, workspaceManager } }),
    dialog: createDialogMock()[0],
  }
}

suite("Download All Exercises command", function () {
  beforeEach(function () {
    vi.clearAllMocks()
  })

  test("downloads every exercise of the course not on disk yet", async function () {
    const context = harness([1])

    await downloadExercisesOfCourse(context, idOfTmcCourse(42))

    expect(vi.mocked(downloadCourseExercises).mock.calls[0]?.slice(1)).toEqual([
      idOfTmcCourse(42),
      [idOfTmcExercise(2)],
    ])
    expect(context.dialog.statusMessage).toHaveBeenCalledWith(
      "Downloaded 1 exercise of Python Course.",
    )
  })

  test("with only one course added, needs no pick", async function () {
    const context = harness()

    await downloadExercisesOfCourse(context)

    expect(vi.mocked(downloadCourseExercises).mock.calls[0]?.[2]).toEqual([
      idOfTmcExercise(1),
      idOfTmcExercise(2),
    ])
  })

  test("says so when everything is downloaded", async function () {
    const context = harness([1, 2])

    await downloadExercisesOfCourse(context, idOfTmcCourse(42))

    expect(downloadCourseExercises).not.toHaveBeenCalled()
    expect(context.dialog.statusMessage).toHaveBeenCalledWith(
      "Every exercise of Python Course is already downloaded.",
    )
  })

  test("reports a download that fails, naming the course", async function () {
    vi.mocked(downloadCourseExercises).mockResolvedValueOnce(Err(new Error("offline")))
    const context = harness()

    await downloadExercisesOfCourse(context, idOfTmcCourse(42))

    expect(context.dialog.reportError).toHaveBeenCalledWith(
      "Failed to download the exercises of Python Course.",
      expect.objectContaining({ message: "offline" }),
    )
  })
})
