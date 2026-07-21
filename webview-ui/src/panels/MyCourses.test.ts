import { render } from "@testing-library/svelte"

import type { MyCoursesPanel } from "../shared/shared"
import { findButton } from "../test/dom"
import { postedMessages } from "../test/setup"
import MyCourses from "./MyCourses.svelte"

// Regression test: `sourcePanel` must be posted as the narrow `{id, type}` the
// `selectPlatform` schema expects, not the full Svelte 5 `$state`-backed `panel` object,
// which fails structured clone with a `DataCloneError`.
const panel: MyCoursesPanel = { id: 7, type: "MyCourses", courseDeadlines: {} }

suite("MyCourses panel", () => {
  test("posts a minimal sourcePanel when the user selects a platform", async () => {
    render(MyCourses, { props: { panel } })
    postedMessages.mockClear()

    const addNewCourseButton = await findButton("Add new course")
    addNewCourseButton.click()

    expect(postedMessages).toHaveBeenCalledWith({
      type: "selectPlatform",
      sourcePanel: { id: 7, type: "MyCourses" },
    })
  })
})
