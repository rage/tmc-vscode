import { vi } from "vitest"
import * as vscode from "vscode"

import * as actions from "../../actions"
import type { ReadyActionContext } from "../../actions/types"
import type { Item } from "../../api/dialog"
import { switchWorkspace } from "../../commands/switchWorkspace"
import type { UserData } from "../../config/userdata"
import type { LocalCourseData } from "../../shared/shared"
import { createMockActionContext } from "../mocks/actionContext"
import { createDialogMock } from "../mocks/dialog"

vi.mock("../../actions", () => ({
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

/** VS Code names a course window `<slug>-<backend> (Workspace)`. */
function openWorkspaceNamed(name: string | undefined): void {
  Object.defineProperty(vscode.workspace, "name", { value: name, configurable: true })
}

interface Harness {
  context: ReadyActionContext
  offered: string[]
}

function harness(pick: number | "dismissed" = 0): Harness {
  const [dialog] = createDialogMock()
  const offered: string[] = []
  dialog.selectItem = vi.fn(async (_prompt: unknown, ...items: Item<unknown>[]) => {
    offered.push(...items.map(([label]) => label))
    return pick === "dismissed" ? undefined : items[pick]?.[1]
  }) as unknown as typeof dialog.selectItem

  const userData = { getCourses: () => courses } as unknown as UserData
  return {
    context: { ...createMockActionContext({ startup: { userData } }), dialog },
    offered,
  }
}

suite("Switch workspace command", function () {
  beforeEach(function () {
    vi.mocked(actions.openWorkspace).mockClear()
    openWorkspaceNamed(undefined)
  })

  test("opens the workspace of the course the user picked, tagged by its backend", async function () {
    const { context } = harness(1)

    await switchWorkspace(context)

    expect(actions.openWorkspace).toHaveBeenCalledExactlyOnceWith(context, "python-course", "mooc")
  })

  test("marks the course whose workspace is already open", async function () {
    openWorkspaceNamed("python-course-tmc (Workspace)")
    const { context, offered } = harness()

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

    expect(actions.openWorkspace).not.toHaveBeenCalled()
  })
})
