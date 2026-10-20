import { fireEvent, render, screen, within } from "@testing-library/svelte"
import { tick } from "svelte"

import type { CourseDetailsPanel, CourseHomeView } from "../../../shared/lib"
import { makeMoocKind, makeTmcKind } from "../../../shared/lib"
import { courseHomeExercise, courseHomeView, MOOC_INSTANCE_ID } from "../test/fixtures"
import {
  dispatchToWebview as dispatch,
  postedMessages,
  reloadDocument,
  replyToRequest,
} from "../test/setup"
import { enterScreen } from "../utilities/uiState.svelte"
import CourseDetails from "./CourseDetails.svelte"

function tmcPanel(): CourseDetailsPanel {
  return { id: 9, type: "CourseDetails", courseId: makeTmcKind({ courseId: 42 }) }
}

function moocPanel(): CourseDetailsPanel {
  return {
    id: 10,
    type: "CourseDetails",
    courseId: makeMoocKind({ moocCourseId: MOOC_INSTANCE_ID }),
  }
}

function sendView(panel: CourseDetailsPanel, view: CourseHomeView = courseHomeView()): void {
  dispatch({ type: "setCourseHomeView", target: { type: "CourseDetails", id: panel.id }, view })
}

/** Renders the course home of `view` and waits for its heading. */
async function renderHome(
  view: CourseHomeView = courseHomeView(),
  panel: CourseDetailsPanel = tmcPanel(),
): Promise<CourseDetailsPanel> {
  render(CourseDetails, { props: { panel } })
  sendView(panel, view)
  await screen.findByRole("heading", { level: 1, name: view.title })
  postedMessages.mockClear()
  return panel
}

/** Clicks the icon button labelled `label`, whose host carries the label as its title. */
async function clickIconButton(label: string): Promise<void> {
  const host = document.querySelector(`vscode-toolbar-button[title="${label}"]`)
  if (!host) {
    throw new Error(`no icon button labelled "${label}"`)
  }
  await fireEvent.click(host)
}

function courseAction(panel: CourseDetailsPanel, action: string): unknown {
  return { type: "courseAction", sourcePanel: { id: panel.id, type: panel.type }, action }
}

function exerciseAction(panel: CourseDetailsPanel, id: number, action: string): unknown {
  return {
    type: "courseExerciseAction",
    sourcePanel: { id: panel.id, type: panel.type },
    exerciseId: makeTmcKind({ tmcExerciseId: id }),
    action,
  }
}

const onDiskView = (overrides: Partial<CourseHomeView> = {}): CourseHomeView =>
  courseHomeView({
    parts: [
      {
        key: "part01",
        name: "Part 1",
        isDefaultOpen: true,
        exercises: [
          courseHomeExercise(1, "01_hello", { status: "opened", passed: true, awardedPoints: 1 }),
          courseHomeExercise(2, "02_loops"),
        ],
      },
    ],
    ...overrides,
  })

suite("the course home", () => {
  test("requests its course on mount", () => {
    const panel = tmcPanel()
    render(CourseDetails, { props: { panel } })
    expect(postedMessages).toHaveBeenCalledWith({
      type: "requestCourseDetailsData",
      requestId: expect.any(Number),
      sourcePanel: { id: panel.id, type: panel.type, courseId: panel.courseId },
    })
  })

  test("scrolls back to where the student left it once the course is in", async () => {
    const panel = tmcPanel()
    enterScreen(panel)
    render(CourseDetails, { props: { panel } })
    vi.spyOn(window, "scrollY", "get").mockReturnValue(300)
    window.dispatchEvent(new Event("scroll"))
    window.dispatchEvent(new Event("pagehide"))
    reloadDocument()
    const scroll = vi.spyOn(window, "scrollTo").mockImplementation(() => {})

    enterScreen(panel)
    render(CourseDetails, { props: { panel } })
    expect(scroll).not.toHaveBeenCalled()
    replyToRequest("requestCourseDetailsData", { ok: true, value: courseHomeView() })

    await vi.waitFor(() => expect(scroll).toHaveBeenCalledWith(0, 300))
    vi.restoreAllMocks()
  })

  test("heads the page with the course, its organization, points and next deadline", async () => {
    await renderHome(
      courseHomeView({
        awardedPoints: 3,
        availablePoints: 8,
        nextDeadline: {
          at: "2026-10-23T20:59:00Z",
          absolute: "Oct 23, 2026",
          relative: "in 3 days",
        },
      }),
    )

    expect(screen.getByText("mooc · tmc.mooc.fi")).toBeInTheDocument()
    expect(screen.getByRole("meter", { name: "Points" })).toHaveAttribute(
      "aria-valuetext",
      "3 / 8 points",
    )
    expect(screen.getByText("in 3 days")).toHaveAttribute("datetime", "2026-10-23T20:59:00Z")
  })

  test("lists each part's exercises with their state, points and deadline", async () => {
    await renderHome(
      courseHomeView({
        parts: [
          {
            key: "part01",
            name: "Part 1",
            isDefaultOpen: true,
            exercises: [
              courseHomeExercise(1, "01_hello", {
                status: "opened",
                passed: true,
                awardedPoints: 1,
              }),
              courseHomeExercise(2, "02_loops", {
                availablePoints: 2,
                deadline: {
                  at: "2099-01-01T00:00:00Z",
                  absolute: "Jan 1, 2099",
                  relative: "in a while",
                },
              }),
            ],
          },
        ],
      }),
    )

    const [hello, loops] = screen.getAllByRole("listitem")
    expect(hello).toHaveTextContent(/01_hello.*Open.*1\/1/)
    expect(within(hello as HTMLElement).getByText("Passed")).toBeInTheDocument()
    expect(loops).toHaveTextContent(/02_loops.*Not downloaded.*due in a while.*0\/2/)
    expect(screen.getByText("1/2 passed")).toBeInTheDocument()
  })

  test("folds a part away and back, remembering the student's choice", async () => {
    await renderHome(
      courseHomeView({
        parts: [
          {
            key: "a",
            name: "Part 1",
            isDefaultOpen: false,
            exercises: [courseHomeExercise(1, "one")],
          },
        ],
      }),
    )
    const toggle = screen.getByRole("button", { name: "Part 1" })
    expect(toggle).toHaveAttribute("aria-expanded", "false")
    expect(screen.queryByText("one")).not.toBeInTheDocument()

    await fireEvent.click(toggle)

    expect(toggle).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByText("one")).toBeInTheDocument()
  })

  test("offers Download as the one primary action while nothing is downloaded", async () => {
    const panel = await renderHome()

    const download = screen.getByRole("button", { name: "Download 2 Exercises" })
    expect(download).not.toHaveAttribute("secondary")
    expect(screen.queryByRole("button", { name: "Open Course Workspace" })).not.toBeInTheDocument()
    download.click()

    expect(postedMessages).toHaveBeenCalledWith(courseAction(panel, "downloadAllExercises"))
  })

  test("offers to open the course workspace, by course id, once exercises are on disk", async () => {
    // The slug names a file the extension writes and opens, so it is resolved from stored data.
    const panel = await renderHome(onDiskView({ backend: "mooc" }), moocPanel())

    const open = screen.getByRole("button", { name: "Open Course Workspace" })
    expect(open).not.toHaveAttribute("secondary")
    expect(screen.getByRole("button", { name: "Download 1 Exercise" })).toHaveAttribute("secondary")
    open.click()

    expect(postedMessages).toHaveBeenCalledWith({
      type: "openCourseWorkspace",
      courseId: panel.courseId,
    })
  })

  test("in the course workspace, offers the rest of the downloads and closing completed ones", async () => {
    const panel = await renderHome(onDiskView({ isWorkspaceOpen: true }))

    expect(screen.queryByRole("button", { name: "Open Course Workspace" })).not.toBeInTheDocument()
    screen.getByRole("button", { name: "Close 1 Completed Exercise" }).click()

    expect(postedMessages).toHaveBeenCalledWith(courseAction(panel, "closeCompletedExercises"))
  })

  test("shows a download in progress on its rows, and holds the Download button", async () => {
    await renderHome(
      courseHomeView({
        parts: [
          {
            key: "p",
            name: "Part 1",
            isDefaultOpen: true,
            exercises: [courseHomeExercise(1, "one", { status: "downloading" })],
          },
        ],
      }),
    )

    expect(screen.getByRole("listitem")).toHaveTextContent("Downloading…")
    expect(screen.getByRole("button", { name: "Downloading 1 Exercise…" })).toHaveAttribute(
      "disabled",
    )
    expect(screen.getByText("Downloading 1 exercise")).toBeInTheDocument()
  })

  test("downloads, opens, resets and restores single exercises from their rows", async () => {
    const panel = await renderHome(onDiskView())

    await clickIconButton("Download 02_loops")
    await clickIconButton("Open 01_hello")
    screen.getByRole("button", { name: "02_loops" }).click()
    await fireEvent.click(screen.getByRole("button", { name: "More Actions for 01_hello" }))
    await tick()
    await fireEvent.click(screen.getByRole("menuitem", { name: "Reset Exercise…" }))
    await fireEvent.click(screen.getByRole("button", { name: "More Actions for 01_hello" }))
    await tick()
    await fireEvent.click(screen.getByRole("menuitem", { name: "Download Old Submission…" }))

    expect(postedMessages.mock.calls.map(([message]) => message)).toEqual([
      exerciseAction(panel, 2, "download"),
      exerciseAction(panel, 1, "open"),
      exerciseAction(panel, 2, "open"),
      exerciseAction(panel, 1, "reset"),
      exerciseAction(panel, 1, "downloadOldSubmission"),
    ])
  })

  test("offers no reset or old submissions for an exercise that is not downloaded", async () => {
    await renderHome()

    expect(screen.queryByRole("button", { name: /More Actions for/ })).not.toBeInTheDocument()
  })

  test("announces new exercises, with Download and a dismiss", async () => {
    const panel = await renderHome(
      courseHomeView({
        newExercises: [{ id: makeTmcKind({ tmcExerciseId: 2 }), name: "02_loops" }],
      }),
    )

    const notices = screen.getByRole("list", { name: "Course notices" })
    expect(notices).toHaveTextContent(/1 new exercise\s*02_loops/)
    within(notices).getByRole("button", { name: "Download" }).click()
    await clickIconButton("Dismiss the new exercises")

    expect(postedMessages.mock.calls.map(([message]) => message)).toEqual([
      courseAction(panel, "downloadNewExercises"),
      courseAction(panel, "dismissNewExercises"),
    ])
  })

  test("lists the exercises with updates, and updates them", async () => {
    const panel = await renderHome(
      courseHomeView({ updates: [{ id: makeTmcKind({ tmcExerciseId: 1 }), name: "01_hello" }] }),
    )

    const notices = screen.getByRole("list", { name: "Course notices" })
    expect(notices).toHaveTextContent(/1 update\s*01_hello\. Your own code is kept\./)
    within(notices).getByRole("button", { name: "Update" }).click()

    expect(postedMessages).toHaveBeenCalledWith(courseAction(panel, "updateExercises"))
  })

  test("says what an automatic update replaced until dismissed", async () => {
    const panel = await renderHome(courseHomeView({ recentlyUpdated: ["01_hello", "02_loops"] }))

    expect(screen.getByRole("list", { name: "Course notices" })).toHaveTextContent(
      /Updated\s*01_hello, 02_loops to the latest version\./,
    )
    await clickIconButton("Dismiss the update notice")

    expect(postedMessages).toHaveBeenCalledWith(courseAction(panel, "dismissRecentUpdates"))
  })

  test("offers trust in Restricted Mode, through the extension's own trust request", async () => {
    await renderHome(courseHomeView({ isRestricted: true, isWorkspaceOpen: true }))

    screen.getByRole("button", { name: "Trust" }).click()

    expect(postedMessages).toHaveBeenCalledWith({
      type: "runCommand",
      command: "tmc.trustCourseWorkspace",
    })
  })

  test("offers login when logged out, and holds the downloads that need it", async () => {
    await renderHome(courseHomeView({ isLoggedIn: false }))

    expect(screen.getByRole("button", { name: "Download 2 Exercises" })).toHaveAttribute("disabled")
    screen.getByRole("button", { name: "Log In" }).click()

    expect(postedMessages).toHaveBeenCalledWith({
      type: "runCommand",
      command: "tmc.showMoocLogin",
    })
  })

  test("says when the backend is unreachable, the course disabled or an exam", async () => {
    await renderHome(courseHomeView({ isOffline: true, isDisabled: true, isExamMode: true }))

    const notices = screen.getByRole("list", { name: "Course notices" })
    expect(notices).toHaveTextContent("tmc.mooc.fi could not be reached")
    expect(notices).toHaveTextContent("This course is disabled")
    expect(notices).toHaveTextContent("This is an exam")
  })

  test("shows no notices when there is nothing to say", async () => {
    await renderHome()

    expect(screen.queryByRole("list", { name: "Course notices" })).not.toBeInTheDocument()
  })

  test("states the soft-deadline policy only when a soft deadline binds", async () => {
    const panel = await renderHome()
    expect(screen.queryByText(/awards only 75%/)).not.toBeInTheDocument()

    sendView(panel, courseHomeView({ hasSoftDeadlines: true }))

    expect(await screen.findByText(/awards only 75% of its points/)).toBeInTheDocument()
  })

  test("keeps the rest of the course's actions in the header's menu", async () => {
    const panel = await renderHome(courseHomeView({ materialUrl: "https://example.com/material" }))
    const menu = screen.getByRole("button", { name: "More Actions" })

    for (const item of [
      "Switch Course Workspace…",
      "Show in Courses View",
      "Open Course Material",
    ]) {
      await fireEvent.click(menu)
      await tick()
      await fireEvent.click(screen.getByRole("menuitem", { name: item }))
    }

    expect(postedMessages.mock.calls.map(([message]) => message)).toEqual([
      courseAction(panel, "switchCourseWorkspace"),
      courseAction(panel, "revealInCoursesView"),
      { type: "openLinkInBrowser", url: "https://example.com/material" },
    ])
  })

  test("offers course material only where the course has it", async () => {
    await renderHome(courseHomeView({ backend: "mooc" }), moocPanel())

    await fireEvent.click(screen.getByRole("button", { name: "More Actions" }))
    await tick()

    expect(screen.queryByRole("menuitem", { name: "Open Course Material" })).not.toBeInTheDocument()
  })

  test("follows the view the host pushes", async () => {
    const panel = await renderHome()

    sendView(panel, courseHomeView({ title: "Renamed Course" }))

    expect(
      await screen.findByRole("heading", { level: 1, name: "Renamed Course" }),
    ).toBeInTheDocument()
  })

  test("shows only why the course could not be loaded, and offers to ask again", async () => {
    const panel = tmcPanel()
    render(CourseDetails, { props: { panel } })
    expect(screen.getByText("Loading the course…")).toBeInTheDocument()

    replyToRequest("requestCourseDetailsData", {
      ok: false,
      error: { message: "Failed to read the course.", details: "no such course" },
    })

    expect(
      await screen.findByRole("heading", { level: 1, name: "Could not load this course" }),
    ).toBeInTheDocument()
    expect(screen.getByRole("alert")).toHaveTextContent("Failed to read the course.")
    expect(screen.queryByText(/Loading/)).not.toBeInTheDocument()

    postedMessages.mockClear()
    ;(await screen.findByRole("button", { name: "Retry" })).click()

    expect(postedMessages).toHaveBeenCalledWith({
      type: "requestCourseDetailsData",
      requestId: expect.any(Number),
      sourcePanel: { id: panel.id, type: panel.type, courseId: panel.courseId },
    })
  })

  test("refreshes the course it shows, showing what the refresh answers", async () => {
    const panel = await renderHome()

    await clickIconButton("Refresh")
    expect(postedMessages).toHaveBeenCalledWith({
      type: "refreshCourseDetails",
      requestId: expect.any(Number),
      sourcePanel: { id: panel.id, type: "CourseDetails" },
    })
    replyToRequest("refreshCourseDetails", {
      ok: true,
      value: courseHomeView({ title: "Renamed Course" }),
    })

    expect(
      await screen.findByRole("heading", { level: 1, name: "Renamed Course" }),
    ).toBeInTheDocument()
  })

  test("stops refreshing when the refresh fails, and says why", async () => {
    await renderHome()
    await clickIconButton("Refresh")
    await tick()
    expect(document.querySelector('[title="Refreshing…"]')).toHaveAttribute("aria-disabled", "true")

    replyToRequest("refreshCourseDetails", {
      ok: false,
      error: { message: "The server did not answer." },
    })

    await vi.waitFor(() =>
      expect(document.querySelector('[title="Refresh"]')).toHaveAttribute("aria-disabled", "false"),
    )
    expect(screen.getByRole("alert")).toHaveTextContent("The server did not answer.")
  })
})
