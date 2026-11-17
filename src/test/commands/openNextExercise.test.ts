import { Err, Ok } from "ts-results"
import { vi } from "vitest"
import * as vscode from "vscode"

import type { CourseIdentifier } from "../../../shared/lib"
import { downloadAndOpenExercises } from "../../actions/openExercises"
import type WorkspaceManager from "../../api/workspaceManager"
import { openNextExercise } from "../../commands/openNextExercise"
import type { UserData } from "../../config/userdata"
import { showExerciseSourceFile } from "../../ui/exerciseSourceFile"
import { shownCourseHome } from "../../ui/shownCourseHome"
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
vi.mock("../../ui/exerciseSourceFile", () => ({
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

function harness(
  isCourseWorkspaceOpen = false,
  stored = course,
): ReturnType<typeof createMockActionContext> {
  const userData = {
    getExercise: () => Ok({ course: stored, exercise: stored.data.exercises[0] }),
    getCourse: () => Ok(stored),
    getCourses: () => [stored, tmcLocalCourse({ id: 43, name: "other-course" })],
    getCourseBySlug: () => Ok(stored),
  } as unknown as UserData
  const workspaceManager = {
    activeCourse: isCourseWorkspaceOpen ? "test-python-course" : undefined,
    activeCourseBackend: isCourseWorkspaceOpen ? "tmc" : undefined,
    activeExercise: undefined,
    getExercises: () => [],
    getExercise: () => nextOnDisk,
    getExerciseContaining: (uri: vscode.Uri) =>
      uri.path.startsWith("/exercises/hello/") ? { id: idOfTmcExercise(1) } : undefined,
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

  test("opens the course home when no exercise is left to do", async function () {
    const context = harness()
    const executeCommand = vi.spyOn(vscode.commands, "executeCommand").mockResolvedValue(undefined)
    onTestFinished(() => executeCommand.mockRestore())

    await openNextExercise(context, idOfTmcExercise(3))

    expect(executeCommand).toHaveBeenCalledExactlyOnceWith("tmc.courseDetails", idOfTmcCourse(42))
    expect(context.dialog.statusMessage).not.toHaveBeenCalled()
    expect(downloadAndOpenExercises).not.toHaveBeenCalled()
  })

  test("from the last exercise, opens the course home rather than an earlier one", async function () {
    const context = harness(
      false,
      tmcLocalCourse({
        exercises: [
          tmcCourseExercise({ id: 1, name: "part01-01_hello" }),
          tmcCourseExercise({ id: 3, name: "part01-03_loops" }),
        ],
      }),
    )
    const executeCommand = vi.spyOn(vscode.commands, "executeCommand").mockResolvedValue(undefined)
    onTestFinished(() => executeCommand.mockRestore())

    await openNextExercise(context, idOfTmcExercise(3))

    expect(executeCommand).toHaveBeenCalledExactlyOnceWith("tmc.courseDetails", idOfTmcCourse(42))
    expect(downloadAndOpenExercises).not.toHaveBeenCalled()
  })

  test("shows why the next exercise could not be opened in the course home, not a notification", async function () {
    vi.mocked(downloadAndOpenExercises).mockResolvedValueOnce(Err(new Error("offline")))
    const context = harness()
    const executeCommand = vi
      .spyOn(vscode.commands, "executeCommand")
      .mockImplementation(async (_command: string, courseId: unknown) => {
        shownCourseHome.set(courseId as CourseIdentifier)
      })
    onTestFinished(() => {
      executeCommand.mockRestore()
      shownCourseHome.set(undefined)
    })
    const failures: string[] = []
    const subscription = shownCourseHome.onDidFail(({ headline, error }) =>
      failures.push(`${headline} ${error?.message}`),
    )
    onTestFinished(() => subscription.dispose())

    await openNextExercise(context, idOfTmcExercise(1))

    expect(showExerciseSourceFile).not.toHaveBeenCalled()
    expect(executeCommand).toHaveBeenCalledExactlyOnceWith("tmc.courseDetails", idOfTmcCourse(42))
    expect(failures).toEqual(["Failed to open the next exercise. offline"])
    expect(context.dialog.reportError).not.toHaveBeenCalled()
  })

  test("asks for an exercise outside one", async function () {
    const context = harness()

    await openNextExercise(context, vscode.Uri.file("/elsewhere/file.py"))

    expect(context.dialog.errorNotification).toHaveBeenCalledWith(
      "Open a file of an exercise first.",
    )
  })

  test("with no exercise at hand, opens the one to continue with in the open course", async function () {
    const context = harness(true)

    await openNextExercise(context, undefined)

    expect(context.dialog.selectItem).not.toHaveBeenCalled()
    expect(vi.mocked(downloadAndOpenExercises).mock.calls[0]?.slice(1)).toEqual([
      [idOfTmcExercise(3)],
      idOfTmcCourse(42),
    ])
    expect(vi.mocked(showExerciseSourceFile).mock.calls[0]?.[1]).toBe(nextOnDisk)
  })

  test("with no exercise at hand outside a course workspace, asks which course", async function () {
    const context = harness()
    vi.mocked(context.dialog.selectItem).mockResolvedValueOnce(idOfTmcCourse(42))

    await openNextExercise(context, undefined)

    expect(context.dialog.selectItem).toHaveBeenCalledOnce()
    expect(vi.mocked(downloadAndOpenExercises).mock.calls[0]?.[1]).toEqual([idOfTmcExercise(3)])
  })
})
