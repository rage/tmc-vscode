import { render, screen } from "@testing-library/svelte"

import type { MyCoursesPanel } from "../shared/shared"
import { findButton } from "../test/dom"
import { MOOC_INSTANCE_ID, moocLocalCourse, tmcLocalCourse } from "../test/fixtures"
import { postedMessages } from "../test/setup"
import MyCourses from "./MyCourses.svelte"

// Regression test: `sourcePanel` must be posted as the narrow `{id, type}` the
// `selectPlatform` schema expects, not the full Svelte 5 `$state`-backed `panel` object,
// which fails structured clone with a `DataCloneError`.
const panel: MyCoursesPanel = { id: 7, type: "MyCourses", courseDeadlines: {} }

function dispatch(data: unknown) {
  window.dispatchEvent(new MessageEvent("message", { data }))
}

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

  test("renders a mooc course card among the local courses", async () => {
    render(MyCourses, { props: { panel } })

    dispatch({
      type: "setMyCourses",
      target: { id: panel.id, type: "MyCourses" },
      courses: [moocLocalCourse()],
    })

    expect(await screen.findByRole("heading", { name: /MOOC Python/ })).toBeInTheDocument()
  })

  test("posts addMoocCourse with the requesting panel when a mooc course is selected", () => {
    render(MyCourses, { props: { panel } })
    postedMessages.mockClear()

    dispatch({
      type: "selectedMoocCourse",
      target: { id: panel.id, type: "MyCourses" },
      instanceId: MOOC_INSTANCE_ID,
      courseName: "MOOC Python",
    })

    expect(postedMessages).toHaveBeenCalledWith({
      type: "addMoocCourse",
      instanceId: MOOC_INSTANCE_ID,
      courseName: "MOOC Python",
      requestingPanel: { id: panel.id, type: panel.type },
    })
  })

  // The webview no longer persists these deltas, so a reload restores them only if
  // `setMyCourses` alone is enough to render them.
  test("renders the new-exercise notice from setMyCourses alone", async () => {
    render(MyCourses, { props: { panel } })

    dispatch({
      type: "setMyCourses",
      target: { id: panel.id, type: "MyCourses" },
      courses: [tmcLocalCourse({ newExercises: [101, 102] })],
    })

    expect(await screen.findByText(/2 new exercises found for this course/)).toBeInTheDocument()
  })

  test("renders the disabled notice from setMyCourses alone", async () => {
    render(MyCourses, { props: { panel } })

    dispatch({
      type: "setMyCourses",
      target: { id: panel.id, type: "MyCourses" },
      courses: [tmcLocalCourse({ disabled: true, newExercises: [101] })],
    })

    expect(await screen.findByText(/This course has been disabled/)).toBeInTheDocument()
  })
})
