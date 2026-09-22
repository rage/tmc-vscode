import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
import { vi } from "vitest"

import * as actions from "../../actions"
import type { ReadyActionContext } from "../../actions/types"
import type { Item } from "../../api/dialog"
import { downloadNewExercises } from "../../commands/downloadNewExercises"
import type { UserData } from "../../config/userdata"
import type { LocalCourseData } from "../../shared/shared"
import { CourseIdentifier } from "../../shared/shared"
import { createMockActionContext } from "../mocks/actionContext"
import { createDialogMock } from "../mocks/dialog"

vi.mock("../../actions", () => ({
  downloadNewExercisesForCourse: vi.fn(async () => Ok.EMPTY),
}))

function courseWith(newExercises: number[]): LocalCourseData {
  return {
    kind: "tmc",
    data: { id: 1, name: "python-course", title: "Python Programming", newExercises },
  } as LocalCourseData
}

interface Harness {
  context: ReadyActionContext
  notifications: string[]
  /** Every label the course pick offered, in order. */
  offered: string[]
}

function harness(
  options: {
    course?: Result<LocalCourseData, Error>
    dismissPick?: boolean
  } = {},
): Harness {
  const [dialog] = createDialogMock()
  const notifications: string[] = []
  const offered: string[] = []
  dialog.notification = vi.fn(async (message: string) => {
    notifications.push(message)
  })
  dialog.selectItem = vi.fn(async (_prompt: unknown, ...items: Item<unknown>[]) => {
    offered.push(...items.map(([label]) => label))
    return options.dismissPick ? undefined : items[0]?.[1]
  }) as unknown as typeof dialog.selectItem

  const userData = {
    getCourses: () => [courseWith([10])],
    getCourse: () => options.course ?? Ok(courseWith([10])),
  } as unknown as UserData

  return {
    context: { ...createMockActionContext({ startup: { userData } }), dialog },
    notifications,
    offered,
  }
}

suite("Download new exercises command", function () {
  beforeEach(function () {
    vi.mocked(actions.downloadNewExercisesForCourse).mockResolvedValue(Ok.EMPTY)
  })

  test("downloads the new exercises of the course the user picked", async function () {
    const { context, offered } = harness()

    await downloadNewExercises(context)

    expect(offered).toEqual(["Python Programming"])
    expect(actions.downloadNewExercisesForCourse).toHaveBeenCalledExactlyOnceWith(
      context,
      CourseIdentifier.from(1),
    )
  })

  test("downloads nothing when the course pick is dismissed", async function () {
    const { context } = harness({ dismissPick: true })

    await downloadNewExercises(context)

    expect(actions.downloadNewExercisesForCourse).not.toHaveBeenCalled()
  })

  test("says so, and downloads nothing, when the course has no new exercises", async function () {
    const { context, notifications } = harness({ course: Ok(courseWith([])) })

    await downloadNewExercises(context)

    expect(notifications).toEqual(["There are no new exercises for the course python-course."])
    expect(actions.downloadNewExercisesForCourse).not.toHaveBeenCalled()
  })

  test("reports a course the stored data cannot read", async function () {
    const { context } = harness({ course: Err(new Error("course is missing")) })

    await downloadNewExercises(context)

    expect(context.dialog.reportError).toHaveBeenCalledExactlyOnceWith(
      "Failed to read the selected course.",
      expect.objectContaining({ message: "course is missing" }),
      "tmc",
    )
    expect(actions.downloadNewExercisesForCourse).not.toHaveBeenCalled()
  })

  test("reports a failed download, naming the course", async function () {
    vi.mocked(actions.downloadNewExercisesForCourse).mockResolvedValue(
      Err(new Error("connection error")),
    )
    const { context } = harness()

    await downloadNewExercises(context)

    expect(context.dialog.reportError).toHaveBeenCalledExactlyOnceWith(
      'Failed to download new exercises for course "python-course."',
      expect.objectContaining({ message: "connection error" }),
      "tmc",
    )
  })
})
