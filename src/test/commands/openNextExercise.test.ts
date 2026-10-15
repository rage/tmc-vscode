import { Err, Ok } from "ts-results"
import { vi } from "vitest"
import * as vscode from "vscode"

import { downloadAndOpenExercises } from "../../actions/openExercises"
import type WorkspaceManager from "../../api/workspaceManager"
import { openNextExercise } from "../../commands/openNextExercise"
import type { UserData } from "../../config/userdata"
import { showExerciseSourceFile } from "../../window/exerciseSourceFile"
import { tmcCourseExercise, tmcLocalCourse } from "../fixtures/courses"
import { idOfTmcCourse, idOfTmcExercise } from "../fixtures/identifiers"
import { createMockActionContext } from "../mocks/actionContext"
import { createDialogMock } from "../mocks/dialog"

vi.mock("../../actions/openExercises", () => ({
  downloadAndOpenExercises: vi.fn(async () =>
    Ok({ ids: [], exceededOpenLimit: undefined, warnings: [] }),
  ),
  openExercises: vi.fn(),
}))
vi.mock("../../window/exerciseSourceFile", () => ({
  showExerciseSourceFile: vi.fn(async () => true),
}))

const course = tmcLocalCourse({
  exercises: [
    tmcCourseExercise({ id: 1, name: "part01-01_hello", passed: true }),
    tmcCourseExercise({ id: 2, name: "part01-02_world", passed: true }),
    tmcCourseExercise({ id: 3, name: "part01-03_loops" }),
  ],
})

const nextOnDisk = { id: idOfTmcExercise(3), exerciseSlug: "part01-03_loops" }

function harness(): ReturnType<typeof createMockActionContext> {
  const userData = {
    getExercise: () => Ok({ course, exercise: course.data.exercises[0] }),
  } as unknown as UserData
  const workspaceManager = {
    getExercise: () => nextOnDisk,
    getExerciseContaining: (uri: vscode.Uri) =>
      uri.fsPath.startsWith("/exercises/hello/") ? { id: idOfTmcExercise(1) } : undefined,
  } as unknown as WorkspaceManager
  return {
    ...createMockActionContext({ startup: { userData, workspaceManager } }),
    dialog: createDialogMock()[0],
  }
}

suite("Open Next Exercise command", function () {
  beforeEach(function () {
    vi.clearAllMocks()
  })

  test("opens the next exercise left to do and shows its source file", async function () {
    const context = harness()

    await openNextExercise(context, idOfTmcExercise(1))

    expect(vi.mocked(downloadAndOpenExercises).mock.calls[0]?.slice(1)).toEqual([
      [idOfTmcExercise(3)],
      idOfTmcCourse(42),
    ])
    expect(vi.mocked(showExerciseSourceFile).mock.calls[0]?.[1]).toBe(nextOnDisk)
  })

  test("finds the current exercise from a file of it", async function () {
    const context = harness()

    await openNextExercise(context, vscode.Uri.file("/exercises/hello/src/main.py"))

    expect(vi.mocked(downloadAndOpenExercises).mock.calls[0]?.[1]).toEqual([idOfTmcExercise(3)])
  })

  test("says so when no exercise is left to do", async function () {
    const context = harness()

    await openNextExercise(context, idOfTmcExercise(3))

    expect(context.dialog.statusMessage).toHaveBeenCalledWith(
      "No exercise is left to do in Python Course.",
    )
    expect(downloadAndOpenExercises).not.toHaveBeenCalled()
  })

  test("shows no file when the next exercise could not be opened", async function () {
    vi.mocked(downloadAndOpenExercises).mockResolvedValueOnce(Err(new Error("offline")))
    const context = harness()

    await openNextExercise(context, idOfTmcExercise(1))

    expect(showExerciseSourceFile).not.toHaveBeenCalled()
    expect(context.dialog.reportError).toHaveBeenCalledWith(
      "Failed to open the next exercise.",
      expect.objectContaining({ message: "offline" }),
    )
  })

  test("asks for an exercise outside one", async function () {
    const context = harness()

    await openNextExercise(context, vscode.Uri.file("/elsewhere/file.py"))

    expect(context.dialog.errorNotification).toHaveBeenCalledWith(
      "Open a file of an exercise first.",
    )
  })
})
