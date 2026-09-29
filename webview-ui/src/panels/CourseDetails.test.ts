import { fireEvent, render, screen, waitFor } from "@testing-library/svelte"

import type { CourseDetailsPanel, ExerciseGroup } from "../shared/shared"
import { makeMoocKind, makeTmcKind } from "../shared/shared"
import {
  MOOC_EXERCISE_ID,
  MOOC_INSTANCE_ID,
  moocExerciseGroup,
  moocLocalCourse,
  tmcExerciseGroup,
  tmcLocalCourse,
} from "../test/fixtures"
import { dispatchToWebview as dispatch, postedMessages } from "../test/setup"
import CourseDetails from "./CourseDetails.svelte"

// The first checkbox in the group is the select-all.
async function checkSelectAll(container: HTMLElement): Promise<void> {
  const selectAll = container.querySelector("vscode-checkbox")
  expect(selectAll).not.toBeNull()
  await fireEvent.keyDown(selectAll!, { key: " " })
}

function findExerciseGroup(name = "part01"): Promise<HTMLElement> {
  return screen.findByRole("heading", { level: 2, name: new RegExp(`^${name}`) })
}

function tmcPanel(): CourseDetailsPanel {
  return {
    id: 9,
    type: "CourseDetails",
    courseId: makeTmcKind({ courseId: 42 }),
    exerciseStatuses: { tmc: {}, mooc: {} },
  }
}

function moocPanel(): CourseDetailsPanel {
  return {
    id: 10,
    type: "CourseDetails",
    courseId: makeMoocKind({ instanceId: MOOC_INSTANCE_ID }),
    exerciseStatuses: { tmc: {}, mooc: {} },
  }
}

function sendGroups(panel: CourseDetailsPanel, exerciseGroups: ExerciseGroup[]): void {
  dispatch({
    type: "setCourseGroups",
    target: { type: "CourseDetails", id: panel.id },
    offlineMode: false,
    exerciseGroups,
  })
}

/** The id the panel's mount-time data request carries; its answer has to quote it. */
function dataRequestId(): number {
  const request = postedMessages.mock.calls[0]?.[0] as { requestId: number }
  return request.requestId
}

suite("CourseDetails panel", () => {
  test("requests its course data on mount", () => {
    const panel = tmcPanel()
    render(CourseDetails, { props: { panel } })
    expect(postedMessages).toHaveBeenCalledWith({
      type: "requestCourseDetailsData",
      requestId: expect.any(Number),
      sourcePanel: panel,
    })
  })

  test("renders a tmc course header and its exercise group", async () => {
    const panel = tmcPanel()
    render(CourseDetails, { props: { panel } })

    dispatch({
      type: "setCourseData",
      target: { type: "CourseDetails", id: panel.id },
      courseData: tmcLocalCourse(),
    })
    sendGroups(panel, [tmcExerciseGroup()])

    expect(
      await screen.findByRole("heading", { level: 1, name: "Python Course" }),
    ).toBeInTheDocument()
    await findExerciseGroup()
    expect(screen.getByText("1 / 1 completed")).toBeInTheDocument()
    expect(screen.getByRole("meter", { name: "Points" })).toHaveAttribute(
      "aria-valuetext",
      "1 / 2 points",
    )
  })

  test("renders a mooc course header and its exercise group", async () => {
    const panel = moocPanel()
    render(CourseDetails, { props: { panel } })

    dispatch({
      type: "setCourseData",
      target: { type: "CourseDetails", id: panel.id },
      courseData: moocLocalCourse(),
    })
    sendGroups(panel, [moocExerciseGroup()])

    expect(
      await screen.findByRole("heading", { level: 1, name: "MOOC Python" }),
    ).toBeInTheDocument()
    await findExerciseGroup("MOOC Python")
    expect(screen.getByText("0 / 1 completed")).toBeInTheDocument()
  })

  // courses.mooc.fi courses may have no description at all.
  test("renders a course without a description as loaded", async () => {
    const panel = moocPanel()
    render(CourseDetails, { props: { panel } })

    dispatch({
      type: "setCourseData",
      target: { type: "CourseDetails", id: panel.id },
      courseData: moocLocalCourse({ description: null }),
    })

    await screen.findByRole("heading", { level: 1, name: "MOOC Python" })
    expect(screen.queryByText(/Loading (description|course)/)).not.toBeInTheDocument()
    expect(screen.queryByText("A mooc.fi course about Python.")).not.toBeInTheDocument()
  })

  test("names the breadcrumb and marks the current course in it", async () => {
    const panel = tmcPanel()
    render(CourseDetails, { props: { panel } })
    dispatch({
      type: "setCourseData",
      target: { type: "CourseDetails", id: panel.id },
      courseData: tmcLocalCourse(),
    })

    const breadcrumb = await screen.findByRole("navigation", { name: "Breadcrumb" })
    await waitFor(() => expect(breadcrumb).toHaveTextContent("Python Course"))
    expect(breadcrumb.querySelector("[aria-current=page]")).toHaveTextContent("Python Course")
  })

  test("reflects an exerciseStatusChange broadcast in the status cell", async () => {
    const panel = tmcPanel()
    render(CourseDetails, { props: { panel } })
    sendGroups(panel, [tmcExerciseGroup()])
    await findExerciseGroup()
    expect(screen.getByText("Loading…")).toBeInTheDocument()

    dispatch({
      type: "exerciseStatusChange",
      target: { type: "CourseDetails" },
      courseId: makeTmcKind({ courseId: 42 }),
      exerciseId: makeTmcKind({ tmcExerciseId: 101 }),
      status: "opened",
    })

    expect(await screen.findByText("Opened")).toBeInTheDocument()
  })

  test("applies the whole course's statuses from one setExerciseStatuses", async () => {
    const panel = tmcPanel()
    render(CourseDetails, { props: { panel } })
    sendGroups(panel, [tmcExerciseGroup()])
    await findExerciseGroup()

    dispatch({
      type: "setExerciseStatuses",
      target: { type: "CourseDetails" },
      courseId: makeTmcKind({ courseId: 42 }),
      statuses: [[makeTmcKind({ tmcExerciseId: 101 }), "missing"]],
    })

    expect(await screen.findByText("Not downloaded")).toBeInTheDocument()
  })

  test("ignores a setExerciseStatuses meant for another course", async () => {
    const panel = tmcPanel()
    render(CourseDetails, { props: { panel } })
    sendGroups(panel, [tmcExerciseGroup()])
    await findExerciseGroup()

    dispatch({
      type: "setExerciseStatuses",
      target: { type: "CourseDetails" },
      courseId: makeTmcKind({ courseId: 999 }),
      statuses: [[makeTmcKind({ tmcExerciseId: 101 }), "closed"]],
    })

    await new Promise((resolve) => {
      setTimeout(resolve, 20)
    })
    expect(screen.getByText("Loading…")).toBeInTheDocument()
  })

  test("shows the offline-mode notice from setCourseGroups", async () => {
    const panel = tmcPanel()
    render(CourseDetails, { props: { panel } })
    dispatch({
      type: "setCourseGroups",
      target: { type: "CourseDetails", id: panel.id },
      offlineMode: true,
      exerciseGroups: [tmcExerciseGroup()],
    })
    const notice = await screen.findByText(/Unable to fetch exercise data from server/)
    expect(notice.closest("[role=status]")).not.toBeNull()
  })

  test("states the soft-deadline policy once for the whole course", async () => {
    const panel = tmcPanel()
    render(CourseDetails, { props: { panel } })
    dispatch({
      type: "setCourseData",
      target: { type: "CourseDetails", id: panel.id },
      courseData: tmcLocalCourse(),
    })
    const softExercise = tmcExerciseGroup().exercises[0]!
    sendGroups(panel, [
      tmcExerciseGroup({ exercises: [softExercise] }),
      tmcExerciseGroup({ name: "part02", exercises: [softExercise] }),
    ])
    await findExerciseGroup("part02")

    expect(screen.getAllByText(/award only 75% of the exercise points/)).toHaveLength(1)
  })

  test("posts downloadExercises with the selected tmc identifier", async () => {
    const panel = tmcPanel()
    const { container } = render(CourseDetails, { props: { panel } })
    sendGroups(panel, [tmcExerciseGroup()])
    await findExerciseGroup()

    await checkSelectAll(container)

    const download = await screen.findByRole("button", { name: "Download" })
    postedMessages.mockClear()
    download.click()

    // the tmc id stays a number and survives the postMessage clone
    expect(postedMessages).toHaveBeenCalledWith({
      type: "downloadExercises",
      ids: [makeTmcKind({ tmcExerciseId: 101 })],
      courseId: makeTmcKind({ courseId: 42 }),
      mode: "download",
    })
  })

  test("posts downloadExercises with the selected mooc identifier", async () => {
    const panel = moocPanel()
    const { container } = render(CourseDetails, { props: { panel } })
    sendGroups(panel, [moocExerciseGroup()])
    await findExerciseGroup("MOOC Python")

    await checkSelectAll(container)

    const download = await screen.findByRole("button", { name: "Download" })
    postedMessages.mockClear()
    download.click()

    expect(postedMessages).toHaveBeenCalledWith({
      type: "downloadExercises",
      ids: [makeMoocKind({ moocExerciseId: MOOC_EXERCISE_ID })],
      courseId: makeMoocKind({ instanceId: MOOC_INSTANCE_ID }),
      mode: "download",
    })
  })

  test("opens, closes and clears the selection from the toolbar above the parts", async () => {
    const panel = tmcPanel()
    const { container } = render(CourseDetails, { props: { panel } })
    sendGroups(panel, [tmcExerciseGroup()])
    const part = await findExerciseGroup()
    await checkSelectAll(container)
    const ids = [makeTmcKind({ tmcExerciseId: 101 })]
    const courseId = makeTmcKind({ courseId: 42 })

    const toolbar = await screen.findByRole("region", { name: "Selected exercises" })
    expect(toolbar).toHaveTextContent("1 selected")
    // DOM order is tab order: the selection's actions come before the rows they act on.
    expect(toolbar.compareDocumentPosition(part) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    postedMessages.mockClear()
    ;(await screen.findByRole("button", { name: "Open" })).click()
    ;(await screen.findByRole("button", { name: "Close" })).click()
    expect(postedMessages).toHaveBeenCalledWith({ type: "openExercises", ids, courseId })
    expect(postedMessages).toHaveBeenCalledWith({ type: "closeExercises", ids, courseId })

    ;(await screen.findByRole("button", { name: "Clear selection" })).click()
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Selected exercises" })).not.toBeInTheDocument(),
    )
  })

  test("shows the 'Updates found' notice only when there are updateable exercises", async () => {
    const panel = tmcPanel()
    render(CourseDetails, { props: { panel } })
    dispatch({
      type: "setCourseData",
      target: { type: "CourseDetails", id: panel.id },
      courseData: tmcLocalCourse(),
    })
    await screen.findByRole("heading", { level: 1, name: "Python Course" })
    expect(screen.queryByText(/Updates found for exercises/)).not.toBeInTheDocument()

    dispatch({
      type: "setUpdateables",
      target: { type: "CourseDetails" },
      courseId: makeTmcKind({ courseId: 42 }),
      exerciseIds: [makeTmcKind({ tmcExerciseId: 101 })],
    })
    expect(await screen.findByText(/Updates found for exercises/)).toBeInTheDocument()

    // A broadcast for a DIFFERENT course must not touch this panel's list.
    dispatch({
      type: "setUpdateables",
      target: { type: "CourseDetails" },
      courseId: makeTmcKind({ courseId: 999 }),
      exerciseIds: [],
    })
    await new Promise((resolve) => {
      setTimeout(resolve, 20)
    })
    expect(screen.getByText(/Updates found for exercises/)).toBeInTheDocument()

    dispatch({
      type: "setUpdateables",
      target: { type: "CourseDetails" },
      courseId: makeTmcKind({ courseId: 42 }),
      exerciseIds: [],
    })
    await waitFor(() =>
      expect(screen.queryByText(/Updates found for exercises/)).not.toBeInTheDocument(),
    )
  })

  test("asks for its own course by id, leaving the slug to the extension", async () => {
    // The slug names a file the extension writes and opens, so it is resolved from
    // stored data rather than chosen here.
    const panel = moocPanel()
    render(CourseDetails, { props: { panel } })
    dispatch({
      type: "setCourseData",
      target: { type: "CourseDetails", id: panel.id },
      courseData: moocLocalCourse(),
    })
    await screen.findByRole("heading", { level: 1, name: "MOOC Python" })

    const open = await screen.findByRole("button", { name: "Open workspace" })
    postedMessages.mockClear()
    open.click()

    expect(postedMessages).toHaveBeenCalledWith({
      type: "openCourseWorkspace",
      courseId: makeMoocKind({ instanceId: MOOC_INSTANCE_ID }),
    })
  })

  test("posts the panel's own course id when updating exercises", async () => {
    const panel = moocPanel()
    render(CourseDetails, { props: { panel } })
    dispatch({
      type: "setCourseData",
      target: { type: "CourseDetails", id: panel.id },
      courseData: moocLocalCourse(),
    })
    dispatch({
      type: "setUpdateables",
      target: { type: "CourseDetails" },
      courseId: makeMoocKind({ instanceId: MOOC_INSTANCE_ID }),
      exerciseIds: [makeMoocKind({ moocExerciseId: MOOC_EXERCISE_ID })],
    })

    const update = await screen.findByRole("button", { name: "Update exercises" })
    postedMessages.mockClear()
    update.click()

    expect(postedMessages).toHaveBeenCalledWith({
      type: "downloadExercises",
      ids: [makeMoocKind({ moocExerciseId: MOOC_EXERCISE_ID })],
      courseId: panel.courseId,
      mode: "update",
    })
  })

  test("navigates back with a real button rather than a keypress handler", async () => {
    render(CourseDetails, { props: { panel: tmcPanel() } })
    postedMessages.mockClear()

    const back = screen.getByRole("button", { name: "My Courses" })
    expect(back.tagName).toBe("BUTTON")
    expect(back).not.toHaveAttribute("tabindex")
    back.click()

    expect(postedMessages).toHaveBeenCalledWith({ type: "openMyCourses" })
  })

  test("shows only why the course could not be loaded, and offers to ask again", async () => {
    const panel = tmcPanel()
    render(CourseDetails, { props: { panel } })
    expect(screen.getByText("Loading exercises")).toBeInTheDocument()

    dispatch({
      type: "panelDataResult",
      target: { id: panel.id, type: "CourseDetails" },
      requestId: dataRequestId(),
      error: { message: "Failed to read the course.", details: "no such course" },
    })

    expect(
      await screen.findByRole("heading", { level: 1, name: "Could not load this course" }),
    ).toBeInTheDocument()
    expect(screen.getByRole("alert")).toHaveTextContent("Failed to read the course.")
    expect(screen.getByText("no such course")).toBeInTheDocument()
    expect(screen.queryByText(/Loading/)).not.toBeInTheDocument()

    postedMessages.mockClear()
    ;(await screen.findByRole("button", { name: "Retry" })).click()

    expect(postedMessages).toHaveBeenCalledWith({
      type: "requestCourseDetailsData",
      requestId: expect.any(Number),
      sourcePanel: panel,
    })
  })

  test("posts refreshCourseDetails after a message has replaced the panel", async () => {
    const panel = tmcPanel()
    render(CourseDetails, { props: { panel } })
    dispatch({
      type: "setCourseData",
      target: { type: "CourseDetails", id: panel.id },
      courseData: tmcLocalCourse(),
    })
    postedMessages.mockClear()

    const refresh = await screen.findByRole("button", { name: "Refresh" })
    refresh.click()

    expect(postedMessages).toHaveBeenCalledWith({
      type: "refreshCourseDetails",
      id: makeTmcKind({ courseId: 42 }),
      useCache: false,
    })
  })

  test("stops refreshing when the host reports the refresh finished", async () => {
    const panel = tmcPanel()
    render(CourseDetails, { props: { panel } })
    dispatch({
      type: "setCourseData",
      target: { type: "CourseDetails", id: panel.id },
      courseData: tmcLocalCourse(),
    })
    ;(await screen.findByRole("button", { name: "Refresh" })).click()
    const busy = await screen.findByRole("button", { name: "Refreshing…" })
    expect(busy).toHaveAttribute("aria-disabled", "true")

    dispatch({
      type: "refreshFinished",
      target: { id: panel.id, type: "CourseDetails" },
      ok: false,
      error: { message: "The server did not answer." },
    })

    expect(await screen.findByRole("button", { name: "Refresh" })).toHaveAttribute(
      "aria-disabled",
      "false",
    )
    expect(screen.getByRole("alert")).toHaveTextContent("The server did not answer.")
  })
})
