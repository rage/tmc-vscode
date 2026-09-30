import { vi } from "vitest"

import { fillCoursesView } from "../../init/ui"
import type { CoursesTreeSource } from "../../ui/treeview/treeview"
import type UI from "../../ui/ui"
import { createDegradedContext, createMockActionContext } from "../mocks/actionContext"

function uiWithSource(): [UI, ReturnType<typeof vi.fn>] {
  const setSource = vi.fn()
  return [{ treeDP: { setSource } } as unknown as UI, setSource]
}

suite("fillCoursesView", function () {
  test("a ready startup lists the stored courses", function () {
    const courses = [{ kind: "tmc" }]
    const workspaceManager = {}
    const [ui, setSource] = uiWithSource()

    fillCoursesView({
      ...createMockActionContext({
        startup: {
          userData: { getCourses: () => courses } as never,
          workspaceManager: workspaceManager as never,
        },
      }),
      ui,
    })

    const source = setSource.mock.calls[0]?.[0] as CoursesTreeSource
    expect(source.getCourses()).toBe(courses)
    expect(source.workspaceManager).toBe(workspaceManager)
  })

  // The view stays empty, and its welcome content offers the details and a restart.
  test("a degraded startup lists nothing", function () {
    const [ui, setSource] = uiWithSource()

    fillCoursesView({ ...createDegradedContext(), ui })

    expect(setSource).not.toHaveBeenCalled()
  })
})
