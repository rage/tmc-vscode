import { vi } from "vitest"
import * as vscode from "vscode"

import type { ReadyActionContext } from "../../actions/types"
import type { Item } from "../../api/dialog"
import { pickCourse } from "../../commands/pickCourse"
import type { UserData } from "../../config/userdata"
import type { LocalCourseData } from "../../shared/shared"
import { CourseIdentifier, makeMoocKind, makeTmcKind } from "../../shared/shared"
import { createMockActionContext } from "../mocks/actionContext"
import { createDialogMock } from "../mocks/dialog"

type SelectPrompt = string | { title: string; placeHolder: string }
type NotificationButton = [string, () => void]

const courses = [
  makeTmcKind({ id: 1, name: "tmc-slug", title: "The Python Course" }),
  makeMoocKind({ id: "course-uuid", name: "mooc-slug", title: "Introduction to CS" }),
] as never[] as LocalCourseData[]

function contextWith(
  courseList: LocalCourseData[],
): [ReadyActionContext, ReturnType<typeof createDialogMock>[0]] {
  const [dialog] = createDialogMock()
  return [
    {
      ...createMockActionContext({
        startup: { userData: { getCourses: () => courseList } as UserData },
      }),
      dialog,
    },
    dialog,
  ]
}

suite("pickCourse", function () {
  afterEach(function () {
    vi.restoreAllMocks()
  })

  test("offers to add a course on an empty list, and picks nothing", async function () {
    const [context, dialog] = contextWith([])
    const notification = vi.fn(
      async (_message: string, ..._items: NotificationButton[]) => undefined,
    )
    dialog.notification = notification
    const executeCommand = vi.spyOn(vscode.commands, "executeCommand").mockResolvedValue(undefined)

    const picked = await pickCourse(context, { title: "Title", placeHolder: "Pick one" })

    expect(picked).toBeUndefined()
    expect(notification).toHaveBeenCalledOnce()
    const [message, button] = notification.mock.calls[0] ?? []
    expect(message).toBe("No courses added yet.")
    await button?.[1]()
    expect(executeCommand).toHaveBeenCalledWith("tmc.addNewCourse")
  })

  test("prompts among the user's courses, labelled by title and backend", async function () {
    const [context, dialog] = contextWith(courses)
    const selectItem = vi.fn(async (_prompt: SelectPrompt, ..._items: Item<unknown>[]) => undefined)
    dialog.selectItem = selectItem

    await pickCourse(context, { title: "Course Details", placeHolder: "Which course?" })

    expect(selectItem).toHaveBeenCalledOnce()
    const [prompt, ...items] = selectItem.mock.calls[0] ?? []
    expect(prompt).toEqual({ title: "Course Details", placeHolder: "Which course?" })
    expect(items).toEqual([
      ["The Python Course", CourseIdentifier.from(1), "TMC Server"],
      ["Introduction to CS", CourseIdentifier.from("course-uuid"), "courses.mooc.fi"],
    ])
  })

  test("returns the course identifier the user picked", async function () {
    const [context, dialog] = contextWith(courses)
    dialog.selectItem = vi.fn(
      async (_prompt: SelectPrompt, ...items: Item<unknown>[]) => items[1]?.[1],
    ) as unknown as typeof dialog.selectItem

    const picked = await pickCourse(context, { title: "Title", placeHolder: "Pick one" })

    expect(picked).toEqual(CourseIdentifier.from("course-uuid"))
  })

  test("value picks what a selection yields, and decorate replaces the label", async function () {
    const [context, dialog] = contextWith(courses)
    dialog.selectItem = vi.fn(
      async (_prompt: SelectPrompt, ...items: Item<unknown>[]) => items[0]?.[1],
    ) as unknown as typeof dialog.selectItem

    const picked = await pickCourse(context, {
      title: "Switch Course Workspace",
      placeHolder: "Pick one",
      value: (course: LocalCourseData) => course,
      decorate: (_course: LocalCourseData, title: string) => `${title} (Currently open)`,
    })

    expect(picked).toEqual(courses[0])
    const [, ...items] = vi.mocked(dialog.selectItem).mock.calls[0] ?? []
    expect(items.map((item) => item[0])).toEqual([
      "The Python Course (Currently open)",
      "Introduction to CS (Currently open)",
    ])
  })
})
