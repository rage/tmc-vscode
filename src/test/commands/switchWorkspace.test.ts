import { Err, Ok } from "ts-results"
import { vi } from "vitest"

import { CourseIdentifier, LocalCourseData } from "../../../shared/lib"
import type { ReadyActionContext } from "../../actions/types"
import type { Item } from "../../api/dialog"
import type WorkspaceManager from "../../api/workspaceManager"
import { openWorkspace } from "../../commands/openWorkspace"
import { switchWorkspace } from "../../commands/switchWorkspace"
import type { UserData } from "../../config/userdata"
import { createMockActionContext } from "../mocks/actionContext"
import { createDialogMock } from "../mocks/dialog"

vi.mock("../../commands/openWorkspace", () => ({
  openWorkspace: vi.fn(),
}))

const courses = [
  {
    kind: "tmc",
    data: { id: 1, name: "python-course", title: "Python Programming" },
  },
  {
    kind: "mooc",
    data: { id: "course-uuid", name: "python-course", title: "Introduction to CS" },
  },
] as LocalCourseData[]

interface Harness {
  context: ReadyActionContext
  offered: string[]
}

function harness(
  pick: number | "dismissed" = 0,
  open?: Pick<WorkspaceManager, "activeCourse" | "activeCourseBackend">,
): Harness {
  const [dialog] = createDialogMock()
  const offered: string[] = []
  dialog.selectItem = vi.fn(async (_prompt: unknown, ...items: Item<unknown>[]) => {
    offered.push(...items.map(({ label }) => label))
    return pick === "dismissed" ? undefined : items[pick]?.value
  }) as unknown as typeof dialog.selectItem

  const userData = {
    getCourses: () => courses,
    getCourse: (id: CourseIdentifier) => {
      const course = courses.find(
        (candidate) =>
          CourseIdentifier.key(LocalCourseData.getCourseId(candidate)) === CourseIdentifier.key(id),
      )
      return course ? Ok(course) : Err(new Error("no such course"))
    },
  } as unknown as UserData
  return {
    context: {
      ...createMockActionContext({
        startup: {
          userData,
          workspaceManager: {
            activeCourse: open?.activeCourse,
            activeCourseBackend: open?.activeCourseBackend,
          } as WorkspaceManager,
        },
      }),
      dialog,
    },
    offered,
  }
}

suite("Switch workspace command", function () {
  test("opens the workspace of the course the user picked, tagged by its backend", async function () {
    const { context } = harness(1)

    await switchWorkspace(context)

    expect(openWorkspace).toHaveBeenCalledExactlyOnceWith(context, courses[1])
  })

  test("marks the course whose workspace is already open", async function () {
    const { context, offered } = harness(0, {
      activeCourse: "python-course",
      activeCourseBackend: "tmc",
    })

    await switchWorkspace(context)

    // Both courses share the slug, so only the backend tag tells them apart.
    expect(offered).toEqual(["Python Programming (Currently open)", "Introduction to CS"])
  })

  test("marks nothing when no course workspace is open", async function () {
    const { context, offered } = harness()

    await switchWorkspace(context)

    expect(offered).toEqual(["Python Programming", "Introduction to CS"])
  })

  test("opens nothing when the pick is dismissed", async function () {
    const { context } = harness("dismissed")

    await switchWorkspace(context)

    expect(openWorkspace).not.toHaveBeenCalled()
  })
})
