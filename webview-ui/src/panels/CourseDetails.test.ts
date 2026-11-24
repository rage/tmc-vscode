import { fireEvent, render, screen, within } from "@testing-library/svelte"
import { tick } from "svelte"

import type { CourseDetailsPanel, CourseHomeView } from "../../../shared/lib"
import { makeMoocKind, makeTmcKind, LOGGED_OUT_MESSAGE } from "../../../shared/lib"
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

/** A course home row's status icon and the label it has for assistive technology. */
function rowIcon(row: HTMLElement | undefined): { name: string | null; label: string | null } {
  const slot = row?.querySelector(".icon")
  return {
    name: slot?.querySelector("vscode-icon")?.name ?? null,
    label: slot?.getAttribute("title") ?? null,
  }
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
          absolute: "Oct 23, 2026, 11:59 PM",
          relative: "in 3 days",
          brief: "in 3 days",
        },
      }),
    )

    expect(screen.getByText("mooc")).toBeInTheDocument()
    expect(screen.getByRole("meter", { name: "Points" })).toHaveAttribute(
      "aria-valuetext",
      "3 / 8 points",
    )
    expect(screen.getByText("in 3 days")).toHaveAttribute("datetime", "2026-10-23T20:59:00Z")
    expect(screen.getByText("· Oct 23, 2026, 11:59 PM")).toBeInTheDocument()
  })

  test("names a next deadline more than a week off by its date, once", async () => {
    await renderHome(
      courseHomeView({
        nextDeadline: {
          at: "2225-01-01T23:59:00Z",
          absolute: "Jan 2, 2225, 1:59 AM",
          relative: null,
          brief: "Jan 2, 2225",
        },
      }),
    )

    expect(screen.getByText("Jan 2, 2225, 1:59 AM")).toHaveAttribute(
      "datetime",
      "2225-01-01T23:59:00Z",
    )
    expect(screen.queryByText(/days/)).not.toBeInTheDocument()
  })

  test("shows an exercise's review, teacher feedback and instructions under its row", async () => {
    await renderHome(
      courseHomeView({
        parts: [
          {
            key: "part01",
            name: "Part 1",
            isDefaultOpen: true,
            exercises: [
              courseHomeExercise(1, "01_hello", {
                reviewNote: "Give peer reviews on the course page to finish this exercise.",
                teacherReview: {
                  sentence: "A teacher reviewed your answer.",
                  justification: "Tidy.",
                },
                instructions: ["Print hello."],
              }),
            ],
          },
        ],
      }),
    )

    expect(
      screen.getByText("Give peer reviews on the course page to finish this exercise."),
    ).toBeTruthy()
    expect(screen.getByText("Tidy.")).toBeTruthy()
    expect(screen.getByText("Instructions")).toBeTruthy()
    expect(screen.getByText("Print hello.")).toBeTruthy()
  })

  test("offers to add the version that continues an ended course", async () => {
    const panel = await renderHome(
      courseHomeView({
        endedNote: "This course ended on May 1, 2026.",
        successor: { courseId: "next" },
      }),
    )

    expect(screen.getByText("This course ended on May 1, 2026.")).toBeTruthy()
    await fireEvent.click(screen.getByRole("button", { name: "Add the New Version" }))
    expect(postedMessages).toHaveBeenCalledWith(courseAction(panel, "addSuccessorCourse"))
  })

  test("lists each part's exercises with their state, points and deadline", async () => {
    await renderHome(
      courseHomeView({
        isWorkspaceOpen: true,
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
                  absolute: "Jan 1, 2099, 12:00 AM",
                  relative: null,
                  brief: "Jan 1, 2099",
                },
              }),
            ],
          },
        ],
      }),
    )

    const [hello, loops] = screen.getAllByRole("listitem")
    expect(hello).toHaveTextContent(/01_hello.*In workspace.*1\/1/)
    expect(within(hello as HTMLElement).getByText("Passed")).toBeInTheDocument()
    expect(loops).toHaveTextContent(/02_loops.*Not downloaded.*due Jan 1, 2099.*0\/2/)
    expect(screen.getByText("1/2 passed")).toBeInTheDocument()
  })

  test("counts tries left, says why an exercise cannot be submitted, and shows a chapter's lock", async () => {
    await renderHome(
      courseHomeView({
        isWorkspaceOpen: true,
        parts: [
          {
            key: "chapter:2",
            name: "Loops",
            isDefaultOpen: true,
            locked: { reason: "This chapter is locked.", icon: "lock" },
            exercises: [
              courseHomeExercise(1, "while", { status: "opened", triesLeft: 2 }),
              courseHomeExercise(2, "for", {
                status: "opened",
                submitRefusal: {
                  label: "deadline passed",
                  sentence: "The deadline of for has passed.",
                  icon: "watch",
                },
              }),
            ],
          },
        ],
      }),
    )

    const [whileRow, forRow] = screen.getAllByRole("listitem")
    expect(whileRow).toHaveTextContent(/while.*2 tries left/)
    expect(forRow).toHaveTextContent(/for.*deadline passed/)
    expect(within(forRow as HTMLElement).getByText("deadline passed")).toHaveAttribute(
      "title",
      "The deadline of for has passed.",
    )
    expect(screen.getByText(/This chapter is locked\./)).toBeInTheDocument()
    expect(rowIcon(forRow)).toEqual({ name: "watch", label: "The deadline of for has passed." })
  })

  test("a passed exercise of a chapter not unlocked yet shows as passed, the lock on the chapter", async () => {
    await renderHome(
      courseHomeView({
        parts: [
          {
            key: "chapter:2",
            name: "Tour",
            isDefaultOpen: true,
            locked: {
              reason: "Locked until you have completed the chapters before it.",
              icon: "list-ordered",
            },
            exercises: [
              courseHomeExercise(1, "tour_first", {
                status: "opened",
                passed: true,
                awardedPoints: 1,
                submitRefusal: {
                  label: "complete earlier chapters first",
                  sentence: "Complete the chapters before Tour to submit tour_first.",
                  icon: "list-ordered",
                },
              }),
            ],
          },
        ],
      }),
    )

    const [row] = screen.getAllByRole("listitem")
    expect(row).not.toHaveTextContent(/complete earlier chapters first/i)
    expect(within(row as HTMLElement).getByTitle("Passed")).toBeInTheDocument()
    expect(
      screen.getByText(/Locked until you have completed the chapters before it/),
    ).toBeInTheDocument()
  })

  test("says an exercise waits for teacher review instead of showing its held-back points", async () => {
    await renderHome(
      courseHomeView({
        parts: [
          {
            key: "chapter:1",
            name: "Basics",
            isDefaultOpen: true,
            exercises: [
              courseHomeExercise(1, "loops", {
                status: "opened",
                availablePoints: 2,
                pendingReview: {
                  label: "waiting for teacher review",
                  sentence: "The points wait for a teacher's review.",
                  icon: "eye",
                },
                submitRefusal: {
                  label: "locked",
                  sentence: "loops is locked for you.",
                  icon: "lock",
                },
              }),
            ],
          },
        ],
      }),
    )

    const [row] = screen.getAllByRole("listitem")
    expect(within(row as HTMLElement).getByText("waiting for teacher review")).toHaveAttribute(
      "title",
      "The points wait for a teacher's review.",
    )
    expect(row).not.toHaveTextContent("0/2")
    expect(within(row as HTMLElement).queryByText("locked")).not.toBeInTheDocument()
    expect(rowIcon(row)).toEqual({ name: "eye", label: "The points wait for a teacher's review." })
  })

  test("shows points already given alongside a pending review", async () => {
    await renderHome(
      courseHomeView({
        parts: [
          {
            key: "chapter:1",
            name: "Basics",
            isDefaultOpen: true,
            exercises: [
              courseHomeExercise(1, "loops", {
                status: "opened",
                passed: true,
                awardedPoints: 2,
                availablePoints: 2,
                pendingReview: {
                  label: "waiting for the chapter to be locked",
                  sentence: "A teacher reviews this answer, which can change the points.",
                  icon: "milestone",
                },
              }),
            ],
          },
        ],
      }),
    )

    const [row] = screen.getAllByRole("listitem")
    expect(row).toHaveTextContent("2/2")
    expect(
      within(row as HTMLElement).getByText("waiting for the chapter to be locked"),
    ).toBeInTheDocument()
  })

  test("calls an exercise on disk Downloaded until the course workspace is open", async () => {
    await renderHome(
      courseHomeView({
        isWorkspaceOpen: false,
        parts: [
          {
            key: "part01",
            name: "Part 1",
            isDefaultOpen: true,
            exercises: [courseHomeExercise(1, "01_hello", { status: "opened" })],
          },
        ],
      }),
    )

    const [hello] = screen.getAllByRole("listitem")
    expect(hello).toHaveTextContent(/01_hello.*Downloaded/)
    expect(hello).not.toHaveTextContent("In workspace")
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

  test("in the course workspace, continuing stays first while there is more to download", async () => {
    const panel = await renderHome(
      onDiskView({
        isWorkspaceOpen: true,
        nextExercise: { id: makeTmcKind({ tmcExerciseId: 1 }), name: "01_hello", isOnDisk: true },
      }),
    )

    expect(screen.getByRole("button", { name: "Continue: 01_hello" })).not.toHaveAttribute(
      "secondary",
    )
    const download = screen.getByRole("button", { name: "Download 1 Exercise" })
    expect(download).toHaveAttribute("secondary")
    download.click()

    expect(postedMessages).toHaveBeenCalledWith(courseAction(panel, "downloadAllExercises"))
  })

  test("in the course workspace, leaves downloading new exercises to their notice", async () => {
    await renderHome(
      onDiskView({
        isWorkspaceOpen: true,
        nextExercise: { id: makeTmcKind({ tmcExerciseId: 1 }), name: "01_hello", isOnDisk: true },
        newExercises: [{ id: makeTmcKind({ tmcExerciseId: 2 }), name: "02_loops" }],
      }),
    )

    expect(screen.getByRole("button", { name: "Continue: 01_hello" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^Download \d/ })).not.toBeInTheDocument()
    const notices = screen.getByRole("list", { name: "Course notices" })
    expect(within(notices).getByRole("button", { name: "Download" })).toBeInTheDocument()
  })

  test("in the course workspace with nothing to download, continues with the next exercise", async () => {
    const view = onDiskView({
      isWorkspaceOpen: true,
      nextExercise: { id: makeTmcKind({ tmcExerciseId: 2 }), name: "02_loops", isOnDisk: true },
    })
    const [part] = view.parts
    const panel = await renderHome({
      ...view,
      parts: part
        ? [{ ...part, exercises: part.exercises.map((ex) => ({ ...ex, status: "opened" })) }]
        : [],
    })

    const next = screen.getByRole("button", { name: "Continue: 02_loops" })
    expect(next).not.toHaveAttribute("secondary")
    next.click()

    expect(postedMessages).toHaveBeenCalledWith(exerciseAction(panel, 2, "open"))
  })

  test("past the last exercise, says so and offers the one left behind as secondary", async () => {
    const view = onDiskView({
      isWorkspaceOpen: true,
      hasReachedLastExercise: true,
      nextExercise: { id: makeTmcKind({ tmcExerciseId: 2 }), name: "02_loops", isOnDisk: true },
    })
    const [part] = view.parts
    const panel = await renderHome({
      ...view,
      parts: part
        ? [{ ...part, exercises: part.exercises.map((ex) => ({ ...ex, status: "opened" })) }]
        : [],
    })

    const notices = screen.getByRole("list", { name: "Course notices" })
    expect(notices).toHaveTextContent("You reached the last exercise")
    expect(notices).toHaveTextContent("02_loops is still left to do.")
    expect(screen.getByRole("button", { name: "Continue: 02_loops" })).toHaveAttribute("secondary")
    await clickIconButton("Dismiss the last exercise notice")

    expect(postedMessages).toHaveBeenCalledWith(courseAction(panel, "dismissLastExerciseReached"))
  })

  test("offers to download and open a next exercise not on disk", async () => {
    const panel = await renderHome(
      onDiskView({
        isWorkspaceOpen: true,
        nextExercise: { id: makeTmcKind({ tmcExerciseId: 2 }), name: "02_loops", isOnDisk: false },
      }),
    )

    screen.getByRole("button", { name: "Download and Open: 02_loops" }).click()

    expect(postedMessages).toHaveBeenCalledWith(exerciseAction(panel, 2, "open"))
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
    await fireEvent.click(screen.getByRole("menuitem", { name: "History" }))

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

  test("offers only opening an exercise removed from the course", async () => {
    const panel = await renderHome(
      courseHomeView({
        parts: [
          {
            key: ":removed",
            name: "Removed from the course",
            isDefaultOpen: true,
            exercises: [courseHomeExercise(9, "gone", { status: "removed" })],
          },
        ],
      }),
    )

    expect(screen.getByRole("listitem")).toHaveTextContent(/gone.*Removed/)
    expect(screen.queryByRole("button", { name: /Download gone/ })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /More Actions for/ })).not.toBeInTheDocument()
    screen.getByRole("button", { name: "gone" }).click()
    expect(postedMessages.mock.calls.map(([message]) => message)).toContainEqual(
      exerciseAction(panel, 9, "open"),
    )
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

  test("turns the updates notice into a warning of the ones that failed, with Try Again", async () => {
    const hello = makeTmcKind({ tmcExerciseId: 1 })
    const reason = "The exercise on the server is not a valid exercise package."
    const panel = await renderHome(
      courseHomeView({
        updates: [{ id: hello, name: "01_hello" }],
        failedUpdates: [{ id: hello, name: "01_hello", reason }],
      }),
    )

    const notices = screen.getByRole("list", { name: "Course notices" })
    expect(notices).toHaveTextContent(/Couldn't update 1 exercise\s*01_hello\. The exercise on the/)
    expect(within(notices).queryByRole("button", { name: "Update" })).not.toBeInTheDocument()
    within(notices).getByRole("button", { name: "Try Again" }).click()

    expect(postedMessages).toHaveBeenCalledWith(courseAction(panel, "updateExercises"))
  })

  test("says how the AI policy changed until dismissed", async () => {
    const panel = await renderHome(
      courseHomeView({ aiPolicyChange: "AI may not be used at any point." }),
    )

    expect(screen.getByRole("list", { name: "Course notices" })).toHaveTextContent(
      /AI policy changed\s*AI may not be used at any point\./,
    )
    await clickIconButton("Dismiss the AI policy notice")

    expect(postedMessages).toHaveBeenCalledWith(courseAction(panel, "dismissAiPolicyChange"))
  })

  test("asks to install each missing language extension, with Install", async () => {
    const panel = await renderHome(
      courseHomeView({
        missingLanguageExtensions: [
          {
            extensionId: "ms-python.python",
            installSentence: "Install the Python extension to run and debug your code.",
          },
        ],
      }),
    )
    const notices = screen.getByRole("list", { name: "Course notices" })

    expect(notices).toHaveTextContent("Install the Python extension to run and debug your code.")
    within(notices).getByRole("button", { name: "Install" }).click()

    expect(postedMessages).toHaveBeenCalledWith({
      type: "installLanguageExtension",
      sourcePanel: { id: panel.id, type: panel.type },
      extensionId: "ms-python.python",
    })
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

  test("offers login when logged out, and no downloads, which need it", async () => {
    await renderHome(
      onDiskView({
        isLoggedIn: false,
        newExercises: [{ id: makeTmcKind({ tmcExerciseId: 2 }), name: "02_loops" }],
      }),
    )

    expect(screen.queryByRole("button", { name: /^Download/ })).not.toBeInTheDocument()
    expect(document.querySelector(`vscode-toolbar-button[title="Download 02_loops"]`)).toBeNull()
    // Opening an exercise not on disk would download it.
    expect(screen.queryByRole("button", { name: "02_loops" })).toBeNull()
    expect(screen.getByRole("button", { name: "01_hello" })).toBeInTheDocument()
    screen.getByRole("button", { name: "Log In" }).click()

    expect(postedMessages).toHaveBeenCalledWith({
      type: "runCommand",
      command: "tmc.showMoocLogin",
    })
  })

  test("offers no downloads while the backend is unreachable", async () => {
    await renderHome(
      onDiskView({
        isOffline: true,
        newExercises: [{ id: makeTmcKind({ tmcExerciseId: 2 }), name: "02_loops" }],
      }),
    )

    expect(screen.getByRole("button", { name: "Open Course Workspace" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /^Download/ })).not.toBeInTheDocument()
  })

  test("says when the backend is unreachable, the course disabled or an exam", async () => {
    await renderHome(courseHomeView({ isOffline: true, isDisabled: true, isExamMode: true }))

    const notices = screen.getByRole("list", { name: "Course notices" })
    expect(notices).toHaveTextContent("Could not reach the server")
    expect(notices).toHaveTextContent("This course is disabled")
    expect(notices).toHaveTextContent("This is an exam")
  })

  test("tells a student no longer enrolled to enroll again", async () => {
    const panel = moocPanel()
    await renderHome(courseHomeView({ backend: "mooc", isNotEnrolled: true }), panel)

    const notices = screen.getByRole("list", { name: "Course notices" })
    expect(notices).toHaveTextContent("You are not enrolled on this course")
    within(notices).getByRole("button", { name: "Enroll Again" }).click()
    expect(postedMessages).toHaveBeenCalledWith(courseAction(panel, "findCourseOnline"))
    within(notices).getByRole("button", { name: "Remove Course" }).click()
    expect(postedMessages).toHaveBeenCalledWith(courseAction(panel, "removeCourse"))
  })

  test("offers no download to a student no longer enrolled", async () => {
    const panel = moocPanel()
    await renderHome(courseHomeView({ backend: "mooc", isNotEnrolled: true }), panel)

    expect(screen.queryByRole("button", { name: /^Download/ })).toBeNull()
  })

  test.each([
    ["forbidden", "You no longer have access to this course"],
    ["notFound", "This course no longer exists"],
  ] as const)("says why a %s course is out of reach, and what to do", async (accessLoss, title) => {
    const panel = moocPanel()
    await renderHome(courseHomeView({ backend: "mooc", accessLoss, isNotEnrolled: true }), panel)

    const notices = screen.getByRole("list", { name: "Course notices" })
    expect(notices).toHaveTextContent(title)
    expect(notices).toHaveTextContent("Your exercises stay on this computer")
    // The access loss says it all; not being enrolled is the lesser news.
    expect(notices).not.toHaveTextContent("You are not enrolled")
    expect(screen.queryByRole("button", { name: /^Download/ })).toBeNull()
    within(notices).getByRole("button", { name: "Find the Course" }).click()
    expect(postedMessages).toHaveBeenCalledWith(courseAction(panel, "findCourseOnline"))
    within(notices).getByRole("button", { name: "Remove Course" }).click()
    expect(postedMessages).toHaveBeenCalledWith(courseAction(panel, "removeCourse"))
  })

  test("names an expired session as the account status bar item does, with Log In", async () => {
    await renderHome(courseHomeView({ isLoggedIn: false, isSessionExpired: true }))

    const notices = screen.getByRole("list", { name: "Course notices" })
    expect(notices).toHaveTextContent(`Logged out ${LOGGED_OUT_MESSAGE}`)
    expect(notices).not.toHaveTextContent("Not logged in")
    within(notices).getByRole("button", { name: "Log In" }).click()
    expect(postedMessages).toHaveBeenCalledWith({
      type: "runCommand",
      command: "tmc.showMoocLogin",
    })
  })

  test("states the course's AI policy and what it does to AI assistance", async () => {
    await renderHome(courseHomeView({ aiPolicy: { policy: "no_ai", isAiAllowed: false } }))

    expect(
      screen.getByText(
        (_, node) =>
          node?.classList.contains("ai-policy") === true &&
          node.textContent?.replaceAll(/\s+/g, " ").trim() ===
            "AI use: AI may not be used at any point. AI assistance is off in this course.",
      ),
    ).toBeInTheDocument()
  })

  test("says nothing of an AI policy the course has not set", async () => {
    await renderHome(courseHomeView({ aiPolicy: { policy: "not_set", isAiAllowed: false } }))

    expect(screen.queryByText(/AI/)).not.toBeInTheDocument()
  })

  test("shows no notices when there is nothing to say", async () => {
    await renderHome()

    expect(screen.queryByRole("list", { name: "Course notices" })).not.toBeInTheDocument()
  })

  test("says when nothing is left to do, unless the course itself is out of reach", async () => {
    const panel = await renderHome(courseHomeView({ isAllDone: true }))

    expect(screen.getByRole("list", { name: "Course notices" })).toHaveTextContent(
      "Nothing left to do right now",
    )

    sendView(panel, courseHomeView({ isAllDone: true, accessLoss: "forbidden" }))

    await vi.waitFor(() => expect(screen.queryByText(/Nothing left to do/)).not.toBeInTheDocument())
  })

  test("with nothing else left, says an exercise waits for review rather than nothing is left", async () => {
    await renderHome(
      courseHomeView({
        isAllDone: true,
        parts: [
          {
            key: "chapter:1",
            name: "Basics",
            isDefaultOpen: true,
            exercises: [
              courseHomeExercise(1, "loops", {
                status: "opened",
                availablePoints: 1,
                pendingReview: {
                  label: "waiting for teacher review",
                  sentence: "The points wait for a teacher's review.",
                  icon: "eye",
                },
              }),
            ],
          },
        ],
      }),
    )

    const notices = screen.getByRole("list", { name: "Course notices" })
    expect(notices).toHaveTextContent("Waiting for review")
    expect(notices).toHaveTextContent("loops is waiting for teacher review.")
    expect(notices).not.toHaveTextContent("Nothing left to do")
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

  test("opens an exercise's course material page from its row", async () => {
    await renderHome(
      courseHomeView({
        backend: "mooc",
        parts: [
          {
            key: "p",
            name: "Exercises",
            isDefaultOpen: true,
            exercises: [
              courseHomeExercise(1, "one", { materialUrl: "https://courses.example/page" }),
              courseHomeExercise(2, "two"),
            ],
          },
        ],
      }),
      moocPanel(),
    )

    expect(screen.queryByRole("button", { name: "More Actions for two" })).not.toBeInTheDocument()
    await fireEvent.click(screen.getByRole("button", { name: "More Actions for one" }))
    await tick()
    await fireEvent.click(screen.getByRole("menuitem", { name: "Open Course Material" }))

    expect(postedMessages).toHaveBeenCalledWith({
      type: "openLinkInBrowser",
      url: "https://courses.example/page",
    })
  })

  test.each([
    ["https://courses.example/solution", "Show Model Solution", "https://courses.example/solution"],
    [undefined, "Open Course Material", "https://courses.example/page"],
  ] as const)(
    "offers the model solution its backend shows (%s), else the course material",
    async (solutionUrl, label, url) => {
      await renderHome(
        courseHomeView({
          backend: "mooc",
          parts: [
            {
              key: "p",
              name: "Exercises",
              isDefaultOpen: true,
              exercises: [
                courseHomeExercise(1, "one", {
                  materialUrl: "https://courses.example/page",
                  isOutOfTries: true,
                  ...(solutionUrl ? { solutionUrl } : {}),
                }),
              ],
            },
          ],
        }),
        moocPanel(),
      )

      await fireEvent.click(screen.getByRole("button", { name: "More Actions for one" }))
      await tick()
      const other = label === "Show Model Solution" ? "Open Course Material" : "Show Model Solution"
      expect(screen.queryByRole("menuitem", { name: other })).not.toBeInTheDocument()
      await fireEvent.click(screen.getByRole("menuitem", { name: label }))

      expect(postedMessages).toHaveBeenCalledWith({ type: "openLinkInBrowser", url })
    },
  )

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
      error: { message: "Failed to read the course." },
    })

    expect(
      await screen.findByRole("heading", { level: 1, name: "Could not load this course" }),
    ).toBeInTheDocument()
    expect(screen.getByRole("alert")).toHaveTextContent("Failed to read the course.")
    expect(screen.queryByText(/Loading/)).not.toBeInTheDocument()

    postedMessages.mockClear()
    ;(await screen.findByRole("button", { name: "Try Again" })).click()

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

suite("CourseDetails action failures", () => {
  test("keeps a failure the host resends before the course arrives, below the notices", async () => {
    const panel = tmcPanel()
    render(CourseDetails, { props: { panel } })
    dispatch({
      type: "operationFailed",
      target: { id: panel.id, type: panel.type },
      failure: {
        serial: 7,
        tone: "error",
        title: "Failed to download the exercises.",
        operation: "Failed to download the exercises.",
        error: { message: "tmc.mooc.fi returned an error (500)." },
      },
    })
    sendView(panel, courseHomeView({ title: "Python Course" }))

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("Failed to download the exercises.")
    expect(screen.getByRole("heading", { level: 1, name: "Python Course" })).toBeInTheDocument()
  })
})

suite("CourseDetails after the session changes", () => {
  const LOGGED_OUT_ERROR = {
    message: LOGGED_OUT_MESSAGE,
    actions: [{ label: "Log In", command: "tmc.showMoocLogin" as const }],
  }

  async function failRefresh(error: { message: string }): Promise<void> {
    await clickIconButton("Refresh")
    replyToRequest("refreshCourseDetails", { ok: false, error })
    await vi.waitFor(() =>
      expect(document.querySelector('[title="Refresh"]')).toHaveAttribute("aria-disabled", "false"),
    )
  }

  test("a refresh refused for the lost session leaves one Log In, the notice's", async () => {
    const panel = await renderHome(courseHomeView({ isSessionExpired: true }))
    await failRefresh(LOGGED_OUT_ERROR)
    sendView(panel, courseHomeView({ isSessionExpired: true }))
    await tick()

    expect(screen.getAllByRole("button", { name: "Log In" })).toHaveLength(1)
    expect(screen.queryByText("Refresh failed")).not.toBeInTheDocument()
  })

  test("an action's failure leaves its Log In to the logged-out notice", async () => {
    const panel = await renderHome(courseHomeView({ isLoggedIn: false }))
    dispatch({
      type: "operationFailed",
      target: { id: panel.id, type: panel.type },
      failure: {
        serial: 41,
        tone: "error",
        title: "Failed to download the exercise.",
        operation: "Failed to download the exercise.",
        error: LOGGED_OUT_ERROR,
      },
    })

    expect(await screen.findByRole("alert")).toHaveTextContent("Failed to download the exercise.")
    expect(screen.getAllByRole("button", { name: "Log In" })).toHaveLength(1)
  })

  test("a login clears the refresh failure from before it", async () => {
    const panel = await renderHome(courseHomeView({ isLoggedIn: false }))
    await failRefresh({ message: "The server did not answer." })
    expect(screen.getByRole("alert")).toHaveTextContent("The server did not answer.")

    sendView(panel, courseHomeView())

    await vi.waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument())
  })

  test("a refresh that succeeds clears what earlier actions reported", async () => {
    const panel = await renderHome()
    dispatch({
      type: "operationFailed",
      target: { id: panel.id, type: panel.type },
      failure: {
        serial: 42,
        tone: "error",
        title: "Failed to download the exercises.",
        operation: "Failed to download the exercises.",
        error: { message: "The server did not answer." },
      },
    })
    await screen.findByRole("alert")

    await clickIconButton("Refresh")
    replyToRequest("refreshCourseDetails", { ok: true, value: courseHomeView() })

    await vi.waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument())
  })
})
