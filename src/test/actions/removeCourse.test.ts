import { Err, Ok } from "ts-results"
import { vi } from "vitest"

import { removeCourse } from "../../actions/removeCourse"
import type { ReadyActionContext, ReadyStartup } from "../../actions/types"
import type Dialog from "../../api/dialog"
import type { UserData } from "../../config/userdata"
import { CourseIdentifier, makeTmcKind } from "../../shared/shared"
import { createMockActionContext } from "../mocks/actionContext"
import { createDialogMock } from "../mocks/dialog"

function contextWith(
  userData: Partial<UserData>,
  unsetSetting: ReturnType<typeof vi.fn> = vi.fn(async () => Ok.EMPTY),
): [ReadyActionContext, Dialog, ReturnType<typeof vi.fn>] {
  const [dialog] = createDialogMock()
  const refresh = vi.fn()
  return [
    {
      ...createMockActionContext({
        startup: {
          langs: { unsetSetting } as unknown as ReadyStartup["langs"],
          userData: userData as ReadyStartup["userData"],
          workspaceManager: {
            activeCourse: undefined,
            activeCourseBackend: undefined,
            deleteWorkspaceFile: vi.fn(async () => Ok.EMPTY),
          } as unknown as ReadyStartup["workspaceManager"],
        },
      }),
      dialog,
      ui: { treeDP: { refresh } } as unknown as ReadyActionContext["ui"],
    },
    dialog,
    refresh,
  ]
}

suite("removeCourse action", function () {
  const course = makeTmcKind({
    id: 1,
    name: "test-python-course",
    title: "The Python Course",
    description: "",
    organization: "test",
    exercises: [],
    availablePoints: 0,
    awardedPoints: 0,
    perhapsExamMode: false,
    newExercises: [],
    notifyAfter: 0,
    disabled: false,
    materialUrl: null,
  })

  // The entry point that started the removal reports what ended it.
  test("returns a course it cannot look up, without reporting it", async function () {
    const deleteCourse = vi.fn(async () => Ok.EMPTY)
    const [actionContext, dialog] = contextWith({
      getCourse: () => Err(new Error("no such course")),
      deleteCourse,
    } as unknown as Partial<UserData>)

    const result = await removeCourse(actionContext, CourseIdentifier.from(1))

    expect(result.err).toBe(true)
    expect(dialog.reportError).not.toHaveBeenCalled()
    expect(deleteCourse).not.toHaveBeenCalled()
  })

  test("returns a removal that could not be persisted, without reporting it", async function () {
    const error = new Error("globalState is full")
    const [actionContext, dialog, refresh] = contextWith({
      getCourse: () => Ok(course),
      deleteCourse: vi.fn(async () => Err(error)),
    } as unknown as Partial<UserData>)

    const result = await removeCourse(actionContext, CourseIdentifier.from(1))

    expect(result.err && result.val.message).toBe(
      'Failed to remove "test-python-course" from your courses.',
    )
    expect(result.err && result.val.cause).toBe(error)
    expect(dialog.reportError).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
  })

  test("warns about a cleanup it could not do and removes the course anyway", async function () {
    const error = new Error("settings file is read-only")
    const deleteCourse = vi.fn(async () => Ok.EMPTY)
    const [actionContext, dialog] = contextWith(
      { getCourse: () => Ok(course), deleteCourse } as unknown as Partial<UserData>,
      vi.fn(async () => Err(error)),
    )

    const result = await removeCourse(actionContext, CourseIdentifier.from(1))

    expect(result.ok).toBe(true)
    expect(dialog.reportError).toHaveBeenCalledExactlyOnceWith(expect.any(String), error, "tmc")
    expect(deleteCourse).toHaveBeenCalled()
  })

  test("drops the course from the tree once the removal is persisted", async function () {
    const [actionContext, dialog, refresh] = contextWith({
      getCourse: () => Ok(course),
      deleteCourse: vi.fn(async () => Ok.EMPTY),
    } as unknown as Partial<UserData>)

    const result = await removeCourse(actionContext, CourseIdentifier.from(1))

    expect(result.ok).toBe(true)
    expect(dialog.reportError).not.toHaveBeenCalled()
    expect(refresh).toHaveBeenCalled()
  })

  // Left behind, it is reused verbatim when the course is added back.
  test("removes the course's workspace file", async function () {
    const [actionContext] = contextWith({
      getCourse: () => Ok(course),
      deleteCourse: vi.fn(async () => Ok.EMPTY),
    } as unknown as Partial<UserData>)

    await removeCourse(actionContext, CourseIdentifier.from(1))

    expect(
      actionContext.startup.workspaceManager.deleteWorkspaceFile,
    ).toHaveBeenCalledExactlyOnceWith("test-python-course", "tmc")
  })
})
