import { render, screen } from "@testing-library/svelte"
import { tick } from "svelte"

import type { MyCoursesPanel } from "../shared/shared"
import { makeTmcKind } from "../shared/shared"
import { findButton } from "../test/dom"
import { moocLocalCourse, tmcLocalCourse } from "../test/fixtures"
import { dispatchToWebview as dispatch, postedMessages } from "../test/setup"
import MyCourses from "./MyCourses.svelte"

const panel: MyCoursesPanel = { id: 7, type: "MyCourses", courseDeadlines: {} }

/** The id the panel's mount-time data request carries; its answer has to quote it. */
function dataRequestId(): number {
  const request = postedMessages.mock.calls[0]?.[0] as { requestId: number }
  return request.requestId
}

afterEach(() => {
  vi.useRealTimers()
})

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

  test("asks for a course workspace by id, leaving the slug to the extension", async () => {
    // The slug names a file the extension writes and opens, so it is resolved from
    // stored data rather than chosen here.
    render(MyCourses, { props: { panel } })
    dispatch({
      type: "setMyCourses",
      target: { id: panel.id, type: "MyCourses" },
      courses: [tmcLocalCourse()],
    })

    const open = await findButton("Open workspace")
    postedMessages.mockClear()
    open.click()

    expect(postedMessages).toHaveBeenCalledWith({
      type: "openCourseWorkspace",
      courseId: makeTmcKind({ courseId: 42 }),
    })
  })

  test("shows why the courses could not be loaded, and offers to ask again", async () => {
    render(MyCourses, { props: { panel } })
    expect(screen.getByLabelText("Loading")).toBeInTheDocument()

    dispatch({
      type: "panelDataResult",
      target: { id: panel.id, type: "MyCourses" },
      requestId: dataRequestId(),
      error: { message: "Storage is unavailable" },
    })

    expect(await screen.findByText("Storage is unavailable")).toBeInTheDocument()
    expect(screen.queryByLabelText("Loading")).not.toBeInTheDocument()

    postedMessages.mockClear()
    ;(await findButton("Retry")).click()

    expect(postedMessages).toHaveBeenCalledWith({
      type: "requestMyCoursesData",
      requestId: expect.any(Number),
      sourcePanel: panel,
    })
  })

  // A host that crashes, drops the message or returns without answering sends nothing at
  // all, so the panel has to give up on its own rather than spin for the whole session.
  test("gives up when the extension host never answers", async () => {
    vi.useFakeTimers()
    render(MyCourses, { props: { panel } })
    expect(screen.getByLabelText("Loading")).toBeInTheDocument()

    await vi.advanceTimersByTimeAsync(30_000)
    await tick()

    expect(screen.getByText("The extension did not answer in time.")).toBeInTheDocument()
    expect(screen.queryByLabelText("Loading")).not.toBeInTheDocument()
  })

  // Without the id, the answer to a request the panel has already given up on would
  // replace what it is showing.
  test("takes only the answer naming its own request", async () => {
    render(MyCourses, { props: { panel } })
    const requestId = dataRequestId()

    dispatch({
      type: "panelDataResult",
      target: { id: panel.id, type: "MyCourses" },
      requestId: requestId + 1000,
      error: { message: "Answer to someone else's request" },
    })
    dispatch({
      type: "panelDataResult",
      target: { id: panel.id, type: "MyCourses" },
      requestId,
      error: { message: "Storage is unavailable" },
    })

    expect(await screen.findByText("Storage is unavailable")).toBeInTheDocument()
    expect(screen.queryByText("Answer to someone else's request")).not.toBeInTheDocument()
  })

  // Navigating away recreates the panel through `{#key}`, so a timer left behind would
  // outlive every panel that ever asked for data.
  test("leaves no timer running once the panel is destroyed", () => {
    vi.useFakeTimers()
    const { unmount } = render(MyCourses, { props: { panel } })
    expect(vi.getTimerCount()).toBe(1)

    unmount()

    expect(vi.getTimerCount()).toBe(0)
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
