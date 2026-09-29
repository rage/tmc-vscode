import { vi } from "vitest"

import { fillCoursesView } from "../../init/ui"
import type UI from "../../ui/ui"
import { createDegradedContext, createMockActionContext } from "../mocks/actionContext"

function uiWithSource(): [UI, ReturnType<typeof vi.fn>] {
  const setCourseSource = vi.fn()
  return [{ treeDP: { setCourseSource } } as unknown as UI, setCourseSource]
}

suite("fillCoursesView", function () {
  test("a ready startup lists the stored courses", function () {
    const courses = [{ kind: "tmc" }]
    const [ui, setCourseSource] = uiWithSource()

    fillCoursesView({
      ...createMockActionContext({ startup: { userData: { getCourses: () => courses } as never } }),
      ui,
    })

    const source = setCourseSource.mock.calls[0]?.[0] as () => unknown
    expect(source()).toBe(courses)
  })

  // The view stays empty, and its welcome content offers the details and a restart.
  test("a degraded startup lists nothing", function () {
    const [ui, setCourseSource] = uiWithSource()

    fillCoursesView({ ...createDegradedContext(), ui })

    expect(setCourseSource).not.toHaveBeenCalled()
  })
})
