import { render, screen, waitFor } from "@testing-library/svelte"

import type { CourseDetailsPanel } from "../shared/shared"
import { makeMoocKind, makeTmcKind } from "../shared/shared"
import {
  MOOC_EXERCISE_ID,
  MOOC_INSTANCE_ID,
  moocExerciseGroup,
  moocLocalCourse,
  tmcExerciseGroup,
  tmcLocalCourse,
} from "../test/fixtures"
import { postedMessages } from "../test/setup"
import CourseDetails from "./CourseDetails.svelte"

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

function dispatch(data: unknown) {
  window.dispatchEvent(new MessageEvent("message", { data }))
}

suite("CourseDetails panel", () => {
  test("requests its course data on mount", () => {
    const panel = tmcPanel()
    render(CourseDetails, { props: { panel } })
    expect(postedMessages).toHaveBeenCalledWith({
      type: "requestCourseDetailsData",
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
    dispatch({
      type: "setCourseGroups",
      target: { type: "CourseDetails", id: panel.id },
      offlineMode: false,
      exerciseGroups: [tmcExerciseGroup()],
    })

    expect(await screen.findByRole("heading", { name: /Python Course/ })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "part01" })).toBeInTheDocument()
    // one exercise, marked passed
    expect(screen.getByText("Completed: 1 / 1")).toBeInTheDocument()
  })

  test("renders a mooc course header and its exercise group", async () => {
    const panel = moocPanel()
    render(CourseDetails, { props: { panel } })

    dispatch({
      type: "setCourseData",
      target: { type: "CourseDetails", id: panel.id },
      courseData: moocLocalCourse(),
    })
    dispatch({
      type: "setCourseGroups",
      target: { type: "CourseDetails", id: panel.id },
      offlineMode: false,
      exerciseGroups: [moocExerciseGroup()],
    })

    expect(await screen.findByRole("heading", { name: /MOOC Python/ })).toBeInTheDocument()
    expect(screen.getByText("Completed: 0 / 1")).toBeInTheDocument()
  })

  test("reflects an exerciseStatusChange broadcast in the status badge", async () => {
    const panel = tmcPanel()
    render(CourseDetails, { props: { panel } })
    dispatch({
      type: "setCourseGroups",
      target: { type: "CourseDetails", id: panel.id },
      offlineMode: false,
      exerciseGroups: [tmcExerciseGroup()],
    })
    await screen.findByRole("heading", { name: "part01" })
    // before the status arrives the badge shows the loading placeholder
    expect(screen.getByText("Loading...")).toBeInTheDocument()

    dispatch({
      type: "exerciseStatusChange",
      target: { type: "CourseDetails" },
      exerciseId: makeTmcKind({ tmcExerciseId: 101 }),
      status: "opened",
    })

    expect(await screen.findByText("opened")).toBeInTheDocument()
  })

  test("shows the offline-mode banner from setCourseGroups", async () => {
    const panel = tmcPanel()
    render(CourseDetails, { props: { panel } })
    dispatch({
      type: "setCourseGroups",
      target: { type: "CourseDetails", id: panel.id },
      offlineMode: true,
      exerciseGroups: [tmcExerciseGroup()],
    })
    expect(await screen.findByText(/Unable to fetch exercise data from server/)).toBeInTheDocument()
  })

  test("posts downloadExercises with a numeric tmc identifier parsed from the checkbox record key", async () => {
    const panel = tmcPanel()
    const { container } = render(CourseDetails, { props: { panel } })
    dispatch({
      type: "setCourseGroups",
      target: { type: "CourseDetails", id: panel.id },
      offlineMode: false,
      exerciseGroups: [tmcExerciseGroup()],
    })
    await screen.findByRole("heading", { name: "part01" })

    // the first Checkbox span is the group's select-all
    const selectAll = container.querySelector<HTMLElement>('span[role="button"]')
    expect(selectAll).not.toBeNull()
    selectAll?.click()

    const download = await screen.findByRole("button", { name: "Download" })
    postedMessages.mockClear()
    download.click()

    // the tmc id must come back as a number, not the "101" string record key
    expect(postedMessages).toHaveBeenCalledWith({
      type: "downloadExercises",
      ids: [makeTmcKind({ tmcExerciseId: 101 })],
      courseId: makeTmcKind({ courseId: 42 }),
      mode: "download",
    })
  })

  test("posts downloadExercises with a string mooc identifier from the checkbox record key", async () => {
    const panel = moocPanel()
    const { container } = render(CourseDetails, { props: { panel } })
    dispatch({
      type: "setCourseGroups",
      target: { type: "CourseDetails", id: panel.id },
      offlineMode: false,
      exerciseGroups: [moocExerciseGroup()],
    })
    await screen.findByRole("heading", { name: "part01" })

    const selectAll = container.querySelector<HTMLElement>('span[role="button"]')
    selectAll?.click()

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

  test("posts refreshCourseDetails with a snapshotted course id", async () => {
    const panel = tmcPanel()
    render(CourseDetails, { props: { panel } })
    postedMessages.mockClear()

    const refresh = await screen.findByRole("button", { name: "Refresh" })
    refresh.click()

    await waitFor(() => {
      expect(postedMessages).toHaveBeenCalledWith({
        type: "refreshCourseDetails",
        id: makeTmcKind({ courseId: 42 }),
        useCache: false,
      })
    })
  })
})
