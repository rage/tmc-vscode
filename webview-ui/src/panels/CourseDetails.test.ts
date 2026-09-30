import { render, screen } from "@testing-library/svelte"

import type { CourseDetailsPanel } from "../shared/shared"
import { makeMoocKind, makeTmcKind } from "../shared/shared"
import { MOOC_INSTANCE_ID, moocLocalCourse, tmcExercise, tmcLocalCourse } from "../test/fixtures"
import { dispatchToWebview as dispatch, postedMessages, replyToRequest } from "../test/setup"
import CourseDetails from "./CourseDetails.svelte"

function tmcPanel(): CourseDetailsPanel {
  return { id: 9, type: "CourseDetails", courseId: makeTmcKind({ courseId: 42 }) }
}

function moocPanel(): CourseDetailsPanel {
  return {
    id: 10,
    type: "CourseDetails",
    courseId: makeMoocKind({ instanceId: MOOC_INSTANCE_ID }),
  }
}

function sendCourse(panel: CourseDetailsPanel, courseData = tmcLocalCourse()): void {
  dispatch({ type: "setCourseData", target: { type: "CourseDetails", id: panel.id }, courseData })
}

suite("CourseDetails panel", () => {
  test("requests its course data on mount", () => {
    const panel = tmcPanel()
    render(CourseDetails, { props: { panel } })
    expect(postedMessages).toHaveBeenCalledWith({
      type: "requestCourseDetailsData",
      requestId: expect.any(Number),
      sourcePanel: { id: panel.id, type: panel.type, courseId: panel.courseId },
    })
  })

  test("renders the course the host answers its request with", async () => {
    const panel = tmcPanel()
    render(CourseDetails, { props: { panel } })

    replyToRequest("requestCourseDetailsData", { ok: true, value: tmcLocalCourse() })

    expect(
      await screen.findByRole("heading", { level: 1, name: "Python Course" }),
    ).toBeInTheDocument()
  })

  test("renders the course overview, with no exercise list of its own", async () => {
    const panel = tmcPanel()
    render(CourseDetails, { props: { panel } })

    sendCourse(panel, tmcLocalCourse({ materialUrl: "https://example.com/material" }))

    expect(
      await screen.findByRole("heading", { level: 1, name: "Python Course" }),
    ).toBeInTheDocument()
    expect(screen.getByText("A course about Python.")).toBeInTheDocument()
    expect(screen.getByRole("meter", { name: "Points" })).toHaveAttribute(
      "aria-valuetext",
      "1 / 2 points",
    )
    expect(screen.getByRole("link", { name: "Course material" })).toHaveAttribute(
      "href",
      "https://example.com/material",
    )
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument()
    expect(screen.queryByRole("heading", { level: 2 })).not.toBeInTheDocument()
  })

  // courses.mooc.fi courses may have no description at all.
  test("renders a course without a description as loaded", async () => {
    const panel = moocPanel()
    render(CourseDetails, { props: { panel } })

    sendCourse(panel, moocLocalCourse({ description: null }))

    await screen.findByRole("heading", { level: 1, name: "MOOC Python" })
    expect(screen.queryByText(/Loading/)).not.toBeInTheDocument()
    expect(screen.queryByText("A mooc.fi course about Python.")).not.toBeInTheDocument()
  })

  test("states the soft-deadline policy only when a soft deadline binds", async () => {
    const panel = tmcPanel()
    render(CourseDetails, { props: { panel } })
    sendCourse(panel)
    await screen.findByRole("heading", { level: 1, name: "Python Course" })
    expect(screen.queryByText(/award only 75%/)).not.toBeInTheDocument()

    sendCourse(
      panel,
      tmcLocalCourse({
        exercises: [
          tmcExercise({ softDeadline: "2026-10-01T00:00:00Z", deadline: "2026-10-08T00:00:00Z" }),
        ],
      }),
    )

    expect(await screen.findByText(/award only 75% of the exercise points/)).toBeInTheDocument()
  })

  test("sends the student to the Courses view for the exercises", async () => {
    const panel = tmcPanel()
    render(CourseDetails, { props: { panel } })
    sendCourse(panel)
    postedMessages.mockClear()

    ;(await screen.findByRole("button", { name: "Show exercises" })).click()

    expect(postedMessages).toHaveBeenCalledWith({ type: "runCommand", command: "tmc.myCourses" })
  })

  test("asks for its own course by id, leaving the slug to the extension", async () => {
    // The slug names a file the extension writes and opens, so it is resolved from
    // stored data rather than chosen here.
    const panel = moocPanel()
    render(CourseDetails, { props: { panel } })
    sendCourse(panel, moocLocalCourse())
    await screen.findByRole("heading", { level: 1, name: "MOOC Python" })

    const open = await screen.findByRole("button", { name: "Open workspace" })
    postedMessages.mockClear()
    open.click()

    expect(postedMessages).toHaveBeenCalledWith({
      type: "openCourseWorkspace",
      courseId: makeMoocKind({ instanceId: MOOC_INSTANCE_ID }),
    })
  })

  test("shows when the course is disabled, as the host reports it", async () => {
    const panel = tmcPanel()
    render(CourseDetails, { props: { panel } })
    sendCourse(panel)
    await screen.findByRole("heading", { level: 1, name: "Python Course" })

    sendCourse(panel, tmcLocalCourse({ disabled: true }))

    expect(await screen.findByText(/This course has been disabled/)).toBeInTheDocument()
  })

  test("shows only why the course could not be loaded, and offers to ask again", async () => {
    const panel = tmcPanel()
    render(CourseDetails, { props: { panel } })
    expect(screen.getByText("Loading course")).toBeInTheDocument()

    replyToRequest("requestCourseDetailsData", {
      ok: false,
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
      sourcePanel: { id: panel.id, type: panel.type, courseId: panel.courseId },
    })
  })

  test("posts refreshCourseDetails for the course it shows", async () => {
    const panel = tmcPanel()
    render(CourseDetails, { props: { panel } })
    sendCourse(panel)
    postedMessages.mockClear()

    const refresh = await screen.findByRole("button", { name: "Refresh" })
    refresh.click()

    expect(postedMessages).toHaveBeenCalledWith({
      type: "refreshCourseDetails",
      requestId: expect.any(Number),
      sourcePanel: { id: panel.id, type: "CourseDetails" },
    })
  })

  test("shows the course the refresh answers with", async () => {
    const panel = tmcPanel()
    render(CourseDetails, { props: { panel } })
    sendCourse(panel)
    ;(await screen.findByRole("button", { name: "Refresh" })).click()

    replyToRequest("refreshCourseDetails", {
      ok: true,
      value: tmcLocalCourse({ title: "Renamed Course" }),
    })

    expect(
      await screen.findByRole("heading", { level: 1, name: "Renamed Course" }),
    ).toBeInTheDocument()
  })

  test("stops refreshing when the host reports the refresh finished", async () => {
    const panel = tmcPanel()
    render(CourseDetails, { props: { panel } })
    sendCourse(panel)
    ;(await screen.findByRole("button", { name: "Refresh" })).click()
    const busy = await screen.findByRole("button", { name: "Refreshing…" })
    expect(busy).toHaveAttribute("aria-disabled", "true")

    replyToRequest("refreshCourseDetails", {
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
