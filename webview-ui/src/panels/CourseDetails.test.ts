import { fireEvent, render, screen, waitFor } from "@testing-library/svelte"

import type { CourseDetailsPanel } from "../shared/shared"
import { makeMoocKind, makeTmcKind } from "../shared/shared"
import { findButton } from "../test/dom"
import {
  MOOC_EXERCISE_ID,
  MOOC_INSTANCE_ID,
  moocExerciseGroup,
  moocLocalCourse,
  tmcExerciseGroup,
  tmcLocalCourse,
} from "../test/fixtures"
import { postedMessages, savedStates } from "../test/setup"
import CourseDetails from "./CourseDetails.svelte"

// vscode-checkbox is inert under jsdom, so set `.checked` and dispatch `change` directly;
// the first checkbox in the group is the select-all.
async function checkSelectAll(container: HTMLElement): Promise<void> {
  const selectAll = container.querySelector<HTMLElement & { checked: boolean }>("vscode-checkbox")
  expect(selectAll).not.toBeNull()
  selectAll!.checked = true
  await fireEvent.change(selectAll!)
}

// The collapsible's heading lives in shadow DOM, which isn't upgraded under jsdom, so
// match on the light-DOM element's heading attribute instead of a heading role.
function findExerciseGroup(container: HTMLElement): Promise<HTMLElement> {
  return waitFor(() => {
    const el = container.querySelector<HTMLElement>('vscode-collapsible[heading="part01"]')
    if (!el) {
      throw new Error("exercise group not rendered yet")
    }
    return el
  })
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
    const { container } = render(CourseDetails, { props: { panel } })

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
    await findExerciseGroup(container)
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
    const { container } = render(CourseDetails, { props: { panel } })
    dispatch({
      type: "setCourseGroups",
      target: { type: "CourseDetails", id: panel.id },
      offlineMode: false,
      exerciseGroups: [tmcExerciseGroup()],
    })
    await findExerciseGroup(container)
    // before the status arrives the badge shows the loading placeholder
    expect(screen.getByText("Loading…")).toBeInTheDocument()

    dispatch({
      type: "exerciseStatusChange",
      target: { type: "CourseDetails" },
      courseId: makeTmcKind({ courseId: 42 }),
      exerciseId: makeTmcKind({ tmcExerciseId: 101 }),
      status: "opened",
    })

    // the raw enum is rendered as a friendly label
    expect(await screen.findByText("Opened")).toBeInTheDocument()
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
    await findExerciseGroup(container)

    await checkSelectAll(container)

    const download = await findButton("Download")
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
    await findExerciseGroup(container)

    await checkSelectAll(container)

    const download = await findButton("Download")
    postedMessages.mockClear()
    download.click()

    expect(postedMessages).toHaveBeenCalledWith({
      type: "downloadExercises",
      ids: [makeMoocKind({ moocExerciseId: MOOC_EXERCISE_ID })],
      courseId: makeMoocKind({ instanceId: MOOC_INSTANCE_ID }),
      mode: "download",
    })
  })

  test("shows the 'Updates found' banner only when there are updateable exercises", async () => {
    const panel = tmcPanel()
    const { container } = render(CourseDetails, { props: { panel } })
    dispatch({
      type: "setCourseGroups",
      target: { type: "CourseDetails", id: panel.id },
      offlineMode: false,
      exerciseGroups: [tmcExerciseGroup()],
    })
    await findExerciseGroup(container)

    const banner = screen.getByText(/Updates found for exercises/)
    // No setUpdateables yet (undefined) -> hidden.
    expect(banner).not.toBeVisible()

    // A non-empty updateable list -> the banner must be shown.
    dispatch({
      type: "setUpdateables",
      target: { type: "CourseDetails" },
      courseId: makeTmcKind({ courseId: 42 }),
      exerciseIds: [makeTmcKind({ tmcExerciseId: 101 })],
    })
    await waitFor(() => expect(banner).toBeVisible())

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
    expect(banner).toBeVisible()

    // An empty list for our course (e.g. after everything updated) -> hidden again.
    dispatch({
      type: "setUpdateables",
      target: { type: "CourseDetails" },
      courseId: makeTmcKind({ courseId: 42 }),
      exerciseIds: [],
    })
    await waitFor(() => expect(banner).not.toBeVisible())
  })

  test("persists panel state as a structured-cloneable plain object on every message", async () => {
    // savePanelState feeds vscode.setState, which VS Code structured-clones; a
    // raw $state proxy would throw DataCloneError. The setState mock enforces the
    // clone (see test/setup.ts), so this dispatch would throw if a proxy leaked.
    const panel = tmcPanel()
    render(CourseDetails, { props: { panel } })
    savedStates.mockClear()
    dispatch({
      type: "exerciseStatusChange",
      target: { type: "CourseDetails" },
      courseId: makeTmcKind({ courseId: 42 }),
      exerciseId: makeTmcKind({ tmcExerciseId: 101 }),
      status: "opened",
    })
    await waitFor(() => expect(savedStates).toHaveBeenCalled())
    const savedState = savedStates.mock.calls.at(-1)?.[0]
    // must survive a structured clone (no proxies / functions)
    expect(() => structuredClone(savedState)).not.toThrow()
    expect(savedState).toEqual({ panel: expect.objectContaining({ type: "CourseDetails" }) })
  })

  test("posts refreshCourseDetails with a snapshotted course id", async () => {
    const panel = tmcPanel()
    render(CourseDetails, { props: { panel } })
    postedMessages.mockClear()

    const refresh = await findButton("Refresh")
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
