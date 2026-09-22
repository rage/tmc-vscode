import { Err, Ok } from "ts-results"
import { vi } from "vitest"
import * as vscode from "vscode"

import * as actions from "../../actions"
import type { ReadyActionContext } from "../../actions/types"
import type WorkspaceManager from "../../api/workspaceManager"
import type { WorkspaceExercise } from "../../api/workspaceManager"
import { ExerciseStatus } from "../../api/workspaceManager"
import { closeExercise } from "../../commands/closeExercise"
import type { UserData } from "../../config/userdata"
import type { LocalCourseData, LocalCourseExercise } from "../../shared/shared"
import { CourseIdentifier, ExerciseIdentifier } from "../../shared/shared"
import { createMockActionContext } from "../mocks/actionContext"
import { createDialogMock } from "../mocks/dialog"

vi.mock("../../actions", () => ({
  closeExercises: vi.fn(async () => Ok([])),
}))

const uri = vscode.Uri.file("/workspace/mooc/mooc-course/ex-1")
const exercise: WorkspaceExercise = {
  backend: "mooc",
  courseSlug: "mooc-course",
  exerciseSlug: "ex-1",
  status: ExerciseStatus.Open,
  uri,
}

const localExercise = { kind: "mooc", data: { id: "ex-uuid" } } as LocalCourseExercise
const course = { kind: "mooc", data: { id: "course-uuid" } } as LocalCourseData

interface Harness {
  context: ReadyActionContext
  getExerciseByName: ReturnType<typeof vi.fn>
  confirmation: ReturnType<typeof vi.fn>
}

function harness(
  options: {
    localExercise?: LocalCourseExercise | undefined
    passed?: boolean
    confirmed?: boolean
    courseBySlug?: ReturnType<typeof Ok> | ReturnType<typeof Err>
  } = {},
): Harness {
  const [dialog] = createDialogMock()
  const confirmation = vi.fn(async () => options.confirmed ?? true)
  dialog.confirmation = confirmation

  const getExerciseByName = vi.fn(() =>
    "localExercise" in options ? options.localExercise : localExercise,
  )
  const userData = {
    getExerciseByName,
    getPassed: () => options.passed ?? false,
    getCourseBySlug: () => options.courseBySlug ?? Ok(course),
  } as unknown as UserData

  const workspaceManager = {
    get activeExercise() {
      return exercise
    },
    getExerciseContaining: () => exercise,
  } as unknown as WorkspaceManager

  return {
    context: {
      ...createMockActionContext({ startup: { userData, workspaceManager } }),
      dialog,
    },
    getExerciseByName,
    confirmation,
  }
}

suite("Close exercise command", function () {
  beforeEach(function () {
    vi.mocked(actions.closeExercises).mockClear()
    vi.mocked(actions.closeExercises).mockResolvedValue(Ok([]))
    // jest-mock-vscode's spies are module-level and survive a restore, so the
    // editor-closing assertions below need the history cleared, not restored.
    vi.mocked(vscode.commands.executeCommand).mockReset()
  })

  test("closes the stored exercise the on-disk one names, qualified by its backend", async function () {
    const { context, getExerciseByName } = harness({ passed: true })

    await closeExercise(context, uri)

    expect(getExerciseByName).toHaveBeenCalledExactlyOnceWith("mooc", "mooc-course", "ex-1")
    expect(actions.closeExercises).toHaveBeenCalledExactlyOnceWith(
      context,
      [ExerciseIdentifier.from("ex-uuid")],
      CourseIdentifier.from("course-uuid"),
    )
  })

  test("closes a passed exercise without asking", async function () {
    const { context, confirmation } = harness({ passed: true })

    await closeExercise(context, uri)

    expect(confirmation).not.toHaveBeenCalled()
    expect(actions.closeExercises).toHaveBeenCalledOnce()
  })

  test("asks before closing an unfinished exercise, and closes nothing when refused", async function () {
    const { context, confirmation } = harness({ passed: false, confirmed: false })

    await closeExercise(context, uri)

    expect(confirmation).toHaveBeenCalledOnce()
    expect(String(confirmation.mock.calls[0]?.[0])).toContain("ex-1")
    expect(actions.closeExercises).not.toHaveBeenCalled()
  })

  test("does nothing for an on-disk exercise the user has no stored copy of", async function () {
    const { context, confirmation } = harness({ localExercise: undefined })

    await closeExercise(context, uri)

    expect(confirmation).not.toHaveBeenCalled()
    expect(actions.closeExercises).not.toHaveBeenCalled()
  })

  test("closes the editor once the exercise is closed", async function () {
    const { context } = harness({ passed: true })

    await closeExercise(context, uri)

    expect(vscode.commands.executeCommand).toHaveBeenCalledExactlyOnceWith(
      "workbench.action.closeActiveEditor",
    )
  })

  test("reports a failed close and leaves the editor alone", async function () {
    vi.mocked(actions.closeExercises).mockResolvedValue(Err(new Error("exercise is running")))
    const { context } = harness({ passed: true })

    await closeExercise(context, uri)

    expect(context.dialog.reportError).toHaveBeenCalledExactlyOnceWith(
      "Error when closing exercise.",
      expect.objectContaining({ message: "exercise is running" }),
      "mooc",
    )
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled()
  })

  test("reports a course the stored data cannot resolve", async function () {
    const { context } = harness({ passed: true, courseBySlug: Err(new Error("no such course")) })

    await closeExercise(context, uri)

    expect(actions.closeExercises).not.toHaveBeenCalled()
    expect(context.dialog.reportError).toHaveBeenCalledExactlyOnceWith(
      "Error when closing exercise.",
      expect.objectContaining({ message: "no such course" }),
      "mooc",
    )
  })
})
