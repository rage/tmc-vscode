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
): [ReadyActionContext, Dialog, ReturnType<typeof vi.fn>] {
  const [dialog] = createDialogMock()
  const refresh = vi.fn()
  return [
    {
      ...createMockActionContext({
        startup: {
          langs: {
            unsetSetting: vi.fn(async () => Ok.EMPTY),
          } as unknown as ReadyStartup["langs"],
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

  test("tells the user when the course cannot be looked up", async function () {
    const deleteCourse = vi.fn(async () => Ok.EMPTY)
    const [actionContext, dialog] = contextWith({
      getCourse: () => Err(new Error("no such course")),
      deleteCourse,
    } as unknown as Partial<UserData>)

    await removeCourse(actionContext, CourseIdentifier.from(1))

    expect(dialog.reportError).toHaveBeenCalled()
    expect(deleteCourse).not.toHaveBeenCalled()
  })

  test("tells the user when the removal could not be persisted", async function () {
    const error = new Error("globalState is full")
    const [actionContext, dialog, refresh] = contextWith({
      getCourse: () => Ok(course),
      deleteCourse: vi.fn(async () => Err(error)),
    } as unknown as Partial<UserData>)

    await removeCourse(actionContext, CourseIdentifier.from(1))

    expect(dialog.reportError).toHaveBeenCalledWith(expect.any(String), error, "tmc")
    expect(refresh).not.toHaveBeenCalled()
  })

  test("drops the course from the tree once the removal is persisted", async function () {
    const [actionContext, dialog, refresh] = contextWith({
      getCourse: () => Ok(course),
      deleteCourse: vi.fn(async () => Ok.EMPTY),
    } as unknown as Partial<UserData>)

    await removeCourse(actionContext, CourseIdentifier.from(1))

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
