import { render, screen, within } from "@testing-library/svelte"
import { tick } from "svelte"

import type { MyCoursesPanel } from "../shared/shared"
import { makeMoocKind, makeTmcKind } from "../shared/shared"
import { MOOC_INSTANCE_ID, moocLocalCourse, tmcLocalCourse } from "../test/fixtures"
import { dispatchToWebview as dispatch, postedMessages, replyToRequest } from "../test/setup"
import { withinShadowRoot } from "../test/shadow"
import MyCourses from "./MyCourses.svelte"

const panel: MyCoursesPanel = { id: 7, type: "MyCourses" }

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

    const addNewCourseButton = await screen.findByRole("button", { name: "Add new course" })
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

  test("says a single new exercise in the singular", async () => {
    render(MyCourses, { props: { panel } })

    dispatch({
      type: "setMyCourses",
      target: { id: panel.id, type: "MyCourses" },
      courses: [tmcLocalCourse({ newExercises: [101] })],
    })

    expect(await screen.findByText("1 new exercise found for this course.")).toBeInTheDocument()
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

    const open = await screen.findByRole("button", { name: "Open workspace for Python Course" })
    postedMessages.mockClear()
    open.click()

    expect(postedMessages).toHaveBeenCalledWith({
      type: "openCourseWorkspace",
      courseId: makeTmcKind({ courseId: 42 }),
    })
  })

  test("shows why the courses could not be loaded, and offers to ask again", async () => {
    render(MyCourses, { props: { panel } })
    expect(screen.getByText("Loading courses")).toBeInTheDocument()

    replyToRequest("requestMyCoursesData", {
      ok: false,
      error: { message: "Storage is unavailable" },
    })

    expect(await screen.findByRole("alert")).toHaveTextContent("Storage is unavailable")
    expect(screen.queryByText("Loading courses")).not.toBeInTheDocument()

    postedMessages.mockClear()
    ;(await screen.findByRole("button", { name: "Retry" })).click()

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
    expect(screen.getByText("Loading courses")).toBeInTheDocument()

    await vi.advanceTimersByTimeAsync(30_000)
    await tick()

    expect(screen.getByText("The extension did not answer in time.")).toBeInTheDocument()
    expect(screen.queryByText("Loading courses")).not.toBeInTheDocument()
  })

  // Without the id, the answer to a request the panel has already given up on would
  // replace what it is showing.
  test("takes only the answer naming its own request", async () => {
    render(MyCourses, { props: { panel } })
    const requestId = dataRequestId()

    replyToRequest(
      "requestMyCoursesData",
      { ok: false, error: { message: "Answer to someone else's request" } },
      requestId + 1000,
    )
    replyToRequest("requestMyCoursesData", {
      ok: false,
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

  // A card is rendered on every open, so a live region in it would announce a standing
  // notice again each time My Courses is shown.
  test("renders course notices without live regions", async () => {
    render(MyCourses, { props: { panel } })

    dispatch({
      type: "setMyCourses",
      target: { id: panel.id, type: "MyCourses" },
      courses: [tmcLocalCourse({ disabled: true }), moocLocalCourse({ newExercises: [] })],
    })

    await screen.findByText(/This course has been disabled/)
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
  })

  test("lists the courses, naming every control after its course", async () => {
    render(MyCourses, { props: { panel } })

    dispatch({
      type: "setMyCourses",
      target: { id: panel.id, type: "MyCourses" },
      courses: [tmcLocalCourse(), moocLocalCourse()],
    })

    const list = await screen.findByRole("list")
    const [tmc, mooc] = within(list).getAllByRole("listitem")
    expect(within(tmc!).getByRole("heading", { level: 2 })).toHaveTextContent("Python Course")
    expect(
      await within(tmc!).findByRole("button", { name: "Open workspace for Python Course" }),
    ).toBeInTheDocument()
    expect(
      await within(mooc!).findByRole("button", { name: "Open workspace for MOOC Python" }),
    ).toBeInTheDocument()
    const remove = mooc!.querySelector("vscode-toolbar-button")!
    expect(
      (await withinShadowRoot(remove)).getByRole("button", { name: "Remove MOOC Python" }),
    ).toBeInTheDocument()
  })

  test("posts the course id when a card's remove, title or new-exercise controls are used", async () => {
    render(MyCourses, { props: { panel } })
    dispatch({
      type: "setMyCourses",
      target: { id: panel.id, type: "MyCourses" },
      courses: [moocLocalCourse({ newExercises: ["cccccccc-cccc-4ccc-accc-cccccccccccc"] })],
    })
    const courseId = makeMoocKind({ instanceId: MOOC_INSTANCE_ID })
    await screen.findByRole("heading", { level: 2, name: /MOOC Python/ })
    postedMessages.mockClear()

    screen.getByRole("button", { name: "MOOC Python" }).click()
    ;(await screen.findByRole("button", { name: "Download new exercises for MOOC Python" })).click()
    const [remove, dismiss] = document.querySelectorAll("vscode-toolbar-button")
    ;(await withinShadowRoot(remove!)).getByRole("button").click()
    ;(await withinShadowRoot(dismiss!)).getByRole("button").click()

    expect(postedMessages.mock.calls.map(([message]) => message)).toEqual([
      { type: "openCourseDetails", courseId },
      {
        type: "downloadExercises",
        ids: [makeMoocKind({ moocExerciseId: "cccccccc-cccc-4ccc-accc-cccccccccccc" })],
        courseId,
        mode: "download",
      },
      { type: "removeCourse", id: courseId },
      { type: "clearNewExercises", courseId },
    ])
  })

  test("moves focus to the card's workspace button when its notice is dismissed", async () => {
    render(MyCourses, { props: { panel } })
    dispatch({
      type: "setMyCourses",
      target: { id: panel.id, type: "MyCourses" },
      courses: [tmcLocalCourse({ newExercises: [101] })],
    })
    const open = await screen.findByRole("button", { name: "Open workspace for Python Course" })
    const dismiss = document.querySelectorAll("vscode-toolbar-button")[1]!

    ;(await withinShadowRoot(dismiss)).getByRole("button").click()

    expect(document.activeElement).toBe(open)
  })

  test("asks the extension to change the exercise folder", async () => {
    render(MyCourses, { props: { panel } })
    dispatch({
      type: "setTmcDataPath",
      target: { type: "MyCourses" },
      tmcDataPath: "/home/student/tmcdata",
    })
    expect(await screen.findByText("/home/student/tmcdata")).toBeInTheDocument()
    postedMessages.mockClear()

    screen.getByRole("button", { name: "Change path" }).click()

    expect(postedMessages).toHaveBeenCalledWith({ type: "changeTmcDataPath" })
  })

  test("says how to start when there are no courses", async () => {
    render(MyCourses, { props: { panel } })
    dispatch({
      type: "setMyCourses",
      target: { id: panel.id, type: "MyCourses" },
      courses: [],
    })

    expect(
      await screen.findByText("Add a course to start completing exercises."),
    ).toBeInTheDocument()
    expect(screen.queryByRole("list")).not.toBeInTheDocument()
  })
})
