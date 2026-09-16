import { render, screen } from "@testing-library/svelte"

import type { MyCoursesPanel } from "../shared/shared"
import { makeTmcKind } from "../shared/shared"
import { findButton } from "../test/dom"
import { moocLocalCourse, tmcLocalCourse } from "../test/fixtures"
import { postedMessages } from "../test/setup"
import MyCourses from "./MyCourses.svelte"

const panel: MyCoursesPanel = { id: 7, type: "MyCourses", courseDeadlines: {} }

function dispatch(data: unknown) {
  window.dispatchEvent(new MessageEvent("message", { data }))
}

suite("MyCourses panel", () => {
  // Adding a course is the extension host's quick pick, so the button asks for the
  // command and carries no panel to route a selection back to.
  test("asks the extension to run the add-course command", async () => {
    render(MyCourses, { props: { panel } })
    postedMessages.mockClear()

    const addNewCourseButton = await findButton("Add new course")
    addNewCourseButton.click()

    expect(postedMessages).toHaveBeenCalledWith({ type: "addNewCourse" })
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

  test("updates only the addressed course when new exercises arrive", async () => {
    render(MyCourses, { props: { panel } })

    dispatch({
      type: "setMyCourses",
      target: { id: panel.id, type: "MyCourses" },
      courses: [tmcLocalCourse(), moocLocalCourse()],
    })
    await screen.findByRole("heading", { name: /Python Course/ })

    dispatch({
      type: "setNewExercises",
      target: { type: "MyCourses" },
      courseId: makeTmcKind({ courseId: 42 }),
      exerciseIds: [makeTmcKind({ tmcExerciseId: 101 }), makeTmcKind({ tmcExerciseId: 102 })],
    })

    expect(await screen.findByText(/2 new exercises found for this course/)).toBeInTheDocument()
    expect(screen.getAllByText(/new exercises found for this course/)).toHaveLength(1)
  })

  test("renders the disabled notice when a course is disabled after load", async () => {
    render(MyCourses, { props: { panel } })

    dispatch({
      type: "setMyCourses",
      target: { id: panel.id, type: "MyCourses" },
      courses: [tmcLocalCourse()],
    })
    await screen.findByRole("heading", { name: /Python Course/ })

    dispatch({
      type: "setCourseDisabledStatus",
      target: { type: "MyCourses" },
      courseId: makeTmcKind({ courseId: 42 }),
      disabled: true,
    })

    expect(await screen.findByText(/This course has been disabled/)).toBeInTheDocument()
  })

  // The announcement is a change inside a region the screen reader already knows, so the
  // region has to be there before there is anything to announce.
  test("keeps each course's live region mounted while it has nothing to say", async () => {
    render(MyCourses, { props: { panel } })

    dispatch({
      type: "setMyCourses",
      target: { id: panel.id, type: "MyCourses" },
      courses: [tmcLocalCourse()],
    })

    await screen.findByRole("heading", { name: /Python Course/ })
    expect(screen.getByRole("alert")).toBeEmptyDOMElement()
  })
})
