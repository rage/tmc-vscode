import { Err, Ok } from "ts-results"
import { vi } from "vitest"

import { closeExercises as closeExercisesAction } from "../../actions/closeExercises"
import { downloadExercisesForUi } from "../../actions/downloadExercisesForUi"
import { downloadAndOpenExercises } from "../../actions/openExercises"
import type { ReadyActionContext } from "../../actions/types"
import type WorkspaceManager from "../../api/workspaceManager"
import { ExerciseStatus } from "../../api/workspaceManager"
import type { UserData } from "../../config/userdata"
import { BottleneckError } from "../../errors"
import type { CourseIdentifier, ExerciseStatus as RowStatus } from "../../shared/shared"
import { makeMoocKind, makeTmcKind } from "../../shared/shared"
import {
  closeCompletedExercises,
  closeExercises,
  dismissNewExercises,
  downloadExercises,
  openExercises,
  targetRows,
  updateCourseExercises,
} from "../../ui/treeview/treeCommands"
import { ExerciseTreeItem, PartTreeItem } from "../../ui/treeview/treeview"
import { updateablesRegistry } from "../../ui/updateablesRegistry"
import { createMockActionContext } from "../mocks/actionContext"
import { createDialogMock } from "../mocks/dialog"

vi.mock("../../actions/downloadExercisesForUi", () => ({
  downloadExercisesForUi: vi.fn(async () => Ok.EMPTY),
}))
vi.mock("../../actions/openExercises", () => ({
  downloadAndOpenExercises: vi.fn(async () => Ok({ ids: [], exceededOpenLimit: undefined })),
  openExercises: vi.fn(),
}))
vi.mock("../../actions/closeExercises", () => ({
  closeExercises: vi.fn(async (_context: unknown, ids: unknown[]) => Ok(ids)),
}))

const BUSY = "Some of these exercises are already downloading."

const tmcCourse = makeTmcKind({ courseId: 1 })
const moocCourse = makeMoocKind({ instanceId: "course-uuid" })

function row(courseId: CourseIdentifier, id: number | string, status: RowStatus): ExerciseTreeItem {
  return Object.assign(Object.create(ExerciseTreeItem.prototype) as ExerciseTreeItem, {
    id: `${courseId.kind}/${id}`,
    courseId,
    exerciseId:
      typeof id === "number"
        ? makeTmcKind({ tmcExerciseId: id })
        : makeMoocKind({ moocExerciseId: id }),
    status,
  })
}

function part(...children: ExerciseTreeItem[]): PartTreeItem {
  return Object.assign(Object.create(PartTreeItem.prototype) as PartTreeItem, { children })
}

function courseContext(): ReadyActionContext {
  const course = makeTmcKind({
    id: 1,
    name: "python-course",
    exercises: [
      { id: 1, name: "part01-01_done", passed: true },
      { id: 2, name: "part01-02_todo", passed: false },
      { id: 3, name: "part01-03_closed", passed: true },
    ],
  })
  const workspaceExercises = [
    { exerciseSlug: "part01-01_done", status: ExerciseStatus.Open },
    { exerciseSlug: "part01-02_todo", status: ExerciseStatus.Open },
    { exerciseSlug: "part01-03_closed", status: ExerciseStatus.Closed },
  ]
  const [dialog] = createDialogMock()
  return {
    ...createMockActionContext({
      startup: {
        userData: { getCourse: () => Ok(course) } as unknown as UserData,
        workspaceManager: {
          getExercisesByCourseSlug: () => workspaceExercises,
        } as unknown as WorkspaceManager,
      },
    }),
    dialog,
  }
}

function context(): ReadyActionContext {
  const [dialog] = createDialogMock()
  return { ...createMockActionContext(), dialog }
}

suite("Courses view commands", function () {
  beforeEach(function () {
    vi.clearAllMocks()
    updateablesRegistry.clear()
  })

  test("act on the selection when the clicked row is in it, else on that row alone", function () {
    const clicked = row(tmcCourse, 1, "missing")
    const other = row(tmcCourse, 2, "missing")

    expect(targetRows(clicked, [clicked, other])).toEqual([clicked, other])
    expect(targetRows(clicked, [other])).toEqual([clicked])
    expect(targetRows(clicked, undefined)).toEqual([clicked])
    expect(targetRows(undefined, [other])).toEqual([])
  })

  test("download fetches only what is not on disk, one call per course", async function () {
    const actionContext = context()

    await downloadExercises(actionContext, [
      part(row(tmcCourse, 1, "missing"), row(tmcCourse, 2, "opened"), row(tmcCourse, 3, "new")),
      row(moocCourse, "m-1", "downloadFailed"),
      row(moocCourse, "m-2", "downloading"),
    ])

    expect(vi.mocked(downloadExercisesForUi).mock.calls).toEqual([
      [
        actionContext,
        "download",
        tmcCourse,
        [makeTmcKind({ tmcExerciseId: 1 }), makeTmcKind({ tmcExerciseId: 3 })],
      ],
      [actionContext, "download", moocCourse, [makeMoocKind({ moocExerciseId: "m-1" })]],
    ])
  })

  test("download of an exercise that is also under a selected part fetches it once", async function () {
    const exercise = row(tmcCourse, 1, "missing")

    await downloadExercises(context(), [part(exercise), exercise])

    expect(vi.mocked(downloadExercisesForUi).mock.calls[0]?.[3]).toEqual([
      makeTmcKind({ tmcExerciseId: 1 }),
    ])
  })

  test("a download refused as already running says so", async function () {
    vi.mocked(downloadExercisesForUi).mockResolvedValueOnce(Err(new BottleneckError(BUSY)))
    const actionContext = context()

    await downloadExercises(actionContext, [row(tmcCourse, 2, "missing")])

    expect(actionContext.dialog.notification).toHaveBeenCalledWith(BUSY)
  })

  test("open skips what is already open or on its way", async function () {
    const actionContext = context()

    await openExercises(actionContext, [
      row(tmcCourse, 1, "closed"),
      row(tmcCourse, 2, "opened"),
      row(tmcCourse, 3, "missing"),
      row(tmcCourse, 4, "downloading"),
    ])

    expect(vi.mocked(downloadAndOpenExercises).mock.calls).toEqual([
      [
        actionContext,
        [makeTmcKind({ tmcExerciseId: 1 }), makeTmcKind({ tmcExerciseId: 3 })],
        tmcCourse,
      ],
    ])
  })

  test("open warns past the open-exercise limit, offering to close the completed ones", async function () {
    vi.mocked(downloadAndOpenExercises).mockResolvedValueOnce(
      Ok({ ids: [], exceededOpenLimit: 50 }),
    )
    const actionContext = context()

    await openExercises(actionContext, [row(tmcCourse, 1, "closed")])

    expect(actionContext.dialog.warningNotification).toHaveBeenCalledWith(
      expect.stringMatching(/^You have over 50 exercises open/),
      ["Close Completed Exercises", expect.any(Function)],
    )
  })

  test("close closes only the open exercises", async function () {
    const actionContext = context()

    await closeExercises(actionContext, [row(tmcCourse, 1, "opened"), row(tmcCourse, 2, "closed")])

    expect(vi.mocked(closeExercisesAction).mock.calls).toEqual([
      [actionContext, [makeTmcKind({ tmcExerciseId: 1 })], tmcCourse],
    ])
  })

  suite("closing the completed exercises", function () {
    test("closes the passed exercises still open, and says how many", async function () {
      const actionContext = courseContext()

      await closeCompletedExercises(actionContext, tmcCourse)

      expect(vi.mocked(closeExercisesAction).mock.calls).toEqual([
        [actionContext, [makeTmcKind({ tmcExerciseId: 1 })], tmcCourse],
      ])
      expect(actionContext.dialog.statusMessage).toHaveBeenCalledWith(
        "Closed 1 completed exercise.",
      )
    })

    test("says so when there is nothing to close", async function () {
      vi.mocked(closeExercisesAction).mockClear()
      const actionContext = courseContext()
      const workspaceManager = actionContext.startup.workspaceManager as unknown as {
        getExercisesByCourseSlug: () => unknown[]
      }
      workspaceManager.getExercisesByCourseSlug = () => []

      await closeCompletedExercises(actionContext, tmcCourse)

      expect(closeExercisesAction).not.toHaveBeenCalled()
      expect(actionContext.dialog.statusMessage).toHaveBeenCalledWith(
        "No completed exercises are open.",
      )
    })
  })

  test("update downloads the updates the last check found for the course", async function () {
    const updates = [makeTmcKind({ tmcExerciseId: 5 })]
    updateablesRegistry.set(tmcCourse, updates)
    const actionContext = context()

    await updateCourseExercises(actionContext, tmcCourse)

    expect(downloadExercisesForUi).toHaveBeenCalledWith(actionContext, "update", tmcCourse, updates)
  })

  test("an update refused as already running says so", async function () {
    vi.mocked(downloadExercisesForUi).mockResolvedValueOnce(Err(new BottleneckError(BUSY)))
    const actionContext = context()

    await updateCourseExercises(actionContext, tmcCourse)

    expect(actionContext.dialog.notification).toHaveBeenCalledWith(BUSY)
  })

  test("dismissing the new exercises clears them from the stored course", async function () {
    const clearFromNewExercises = vi.fn().mockResolvedValue(Ok.EMPTY)
    const actionContext = {
      ...createMockActionContext({
        startup: { userData: { clearFromNewExercises } as unknown as UserData },
      }),
      dialog: createDialogMock()[0],
    }

    await dismissNewExercises(actionContext, tmcCourse)

    expect(clearFromNewExercises).toHaveBeenCalledExactlyOnceWith(tmcCourse)
  })
})
