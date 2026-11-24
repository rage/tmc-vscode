import { fireEvent, render, screen, within } from "@testing-library/svelte"
import { tick } from "svelte"
import { vi } from "vitest"

import type { ExerciseTaskSubmissionStatus, SubmissionFinished } from "../../../shared/langsSchema"
import type { ExerciseSubmissionPanel, FeedbackQuestion, SubmissionView } from "../../../shared/lib"
import { makeMoocKind, makeTmcKind, unwrap } from "../../../shared/lib"
import {
  gradingUnavailableView,
  inProgressView,
  moocGradingView,
  standingView,
  submitFailedView,
  testedLocallyView,
  tmcResultView,
} from "../../../src/panels/submissionView"
import { moocGrading, submissionFinished, submissionViewMessage } from "../test/fixtures"
import { dispatchToWebview, postedMessages, reloadDocument, replyToRequest } from "../test/setup"
import { withinShadowRoot } from "../test/shadow"
import { enterScreen } from "../utilities/uiState.svelte"
import ExerciseSubmission from "./ExerciseSubmission.svelte"

const panel: ExerciseSubmissionPanel = {
  id: 12,
  type: "ExerciseSubmission",
  exerciseId: makeTmcKind({ tmcExerciseId: 1 }),
  backend: "tmc",
  exerciseName: "part01-01_hello",
  courseTitle: "Python Course",
}

const moocPanel: ExerciseSubmissionPanel = {
  id: 13,
  type: "ExerciseSubmission",
  exerciseId: makeMoocKind({ moocExerciseId: "mooc-ex-uuid" }),
  backend: "mooc",
  exerciseName: "Sum of three numbers",
  courseTitle: "Introduction to Programming",
  organization: "University of Helsinki",
}

const LOCAL_PASS_AT = 1_800_000_000_000

const FEEDBACK_URL = "https://tmc.mooc.fi/api/v8/core/submissions/1/feedback"

function showView(panelId: number, view: SubmissionView): void {
  dispatchToWebview(submissionViewMessage(panelId, view))
}

/** `view` as the host re-posts it once the student's feedback went through. */
function feedbackSent(view: SubmissionView): SubmissionView {
  if (!view.feedback) {
    throw new Error("the view asks for no feedback")
  }
  return { ...view, feedback: { ...view.feedback, isSent: true } }
}

function showTmcResult(result: SubmissionFinished, questions: FeedbackQuestion[] = []): void {
  showView(panel.id, tmcResultView(result, questions, 2))
}

function showMoocGrading(status: ExerciseTaskSubmissionStatus): void {
  showView(moocPanel.id, moocGradingView(status, 3))
}

function progressLines(): string[] {
  return screen
    .getAllByRole("listitem")
    .map((item) => (item.textContent ?? "").replaceAll(/\s+/g, " ").trim())
}

async function clickToolbarButton(label: string): Promise<void> {
  const host = await screen.findByTitle(label)
  await fireEvent.click((await withinShadowRoot(host)).getByRole("button"))
}

/** The overflow menu's item names, leaving the menu closed. */
async function menuItems(): Promise<string[]> {
  const trigger = screen.queryByRole("button", { name: "More Actions" })
  if (!trigger) {
    return []
  }
  await fireEvent.click(trigger)
  const names = (await screen.findAllByRole("menuitem")).map((item) => item.textContent?.trim())
  await fireEvent.keyDown(screen.getAllByRole("menuitem")[0]!, { key: "Escape" })
  return names.filter((name) => name !== undefined)
}

async function chooseMenuItem(name: string): Promise<void> {
  await fireEvent.click(await screen.findByRole("button", { name: "More Actions" }))
  await fireEvent.click(await screen.findByRole("menuitem", { name }))
}

function isSecondary(button: HTMLElement): boolean {
  return (button as HTMLElement & { secondary: boolean }).secondary
}

async function progressBar(): Promise<HTMLElement> {
  const host = document.querySelector("vscode-progress-bar")!
  return (await withinShadowRoot(host)).getByRole("progressbar", {
    name: "Processing submission",
  })
}

suite("ExerciseSubmission panel (in progress)", () => {
  test("names the exercise and shows activity before the host's first view", () => {
    render(ExerciseSubmission, { props: { panel } })
    expect(screen.getByRole("heading", { level: 1, name: "part01-01_hello" })).toBeInTheDocument()
    expect(screen.getByText("Python Course")).toBeInTheDocument()
    expect(document.querySelector("vscode-progress-bar")).not.toBeNull()
  })

  test("names a mooc exercise by its title, under its course and organization", () => {
    render(ExerciseSubmission, { props: { panel: moocPanel } })
    expect(
      screen.getByRole("heading", { level: 1, name: "Sum of three numbers" }),
    ).toBeInTheDocument()
    expect(
      screen.getByText("Introduction to Programming · University of Helsinki"),
    ).toBeInTheDocument()
  })

  test("lists the progress steps, marking the earlier ones done", async () => {
    render(ExerciseSubmission, { props: { panel } })
    showView(panel.id, inProgressView("grading", { steps: ["Compiling", "Running tests"] }))

    expect(
      await screen.findByRole("heading", { name: "Processing submission…" }),
    ).toBeInTheDocument()
    expect(progressLines()).toEqual(["Done: Compiling", "Running tests"])
  })

  test("renders a reported fraction on the progress bar's own scale", async () => {
    render(ExerciseSubmission, { props: { panel } })
    showView(panel.id, inProgressView("uploading", { fraction: 0.4, steps: ["Compressing"] }))

    await screen.findByText("Compressing")
    const bar = await progressBar()
    expect(bar).toHaveAttribute("aria-valuenow", "40")
    expect(bar).toHaveAttribute("aria-valuemax", "100")
  })

  test("waits on an indeterminate bar when the backend reports no fraction", async () => {
    render(ExerciseSubmission, { props: { panel: moocPanel } })
    showView(moocPanel.id, inProgressView("grading", { steps: ["Grading in progress"] }))

    await screen.findByText("Grading in progress")
    expect(document.querySelector("vscode-progress-bar")!.indeterminate).toBe(true)
  })

  test("offers Run in Background, and the submission's page once there is one", async () => {
    render(ExerciseSubmission, { props: { panel } })
    showView(
      panel.id,
      inProgressView("grading", { steps: [], submissionUrl: "https://tmc.mooc.fi/submissions/1" }),
    )

    const background = await screen.findByRole("button", { name: "Run in Background" })
    expect(isSecondary(background)).toBe(true)
    postedMessages.mockClear()
    await chooseMenuItem("Show Submission in Browser")
    expect(postedMessages).toHaveBeenCalledWith({
      type: "openLinkInBrowser",
      url: "https://tmc.mooc.fi/submissions/1",
    })
    background.click()
    expect(postedMessages).toHaveBeenCalledWith({ type: "closeSidePanel" })
  })

  test("announces a new phase by its headline and a new step by its text", async () => {
    vi.useFakeTimers()
    try {
      render(ExerciseSubmission, { props: { panel } })
      // The indeterminate bar's long-running timer never runs out, so run only the announcer's.
      showView(panel.id, inProgressView("uploading", { steps: [] }))
      await vi.advanceTimersByTimeAsync(1000)
      expect(screen.getByTestId("announcer")).toHaveTextContent("Sending submission…")

      showView(panel.id, inProgressView("uploading", { steps: ["Compressing"] }))
      await vi.advanceTimersByTimeAsync(1000)
      expect(screen.getByTestId("announcer")).toHaveTextContent("Compressing")
    } finally {
      vi.useRealTimers()
    }
  })

  test("closing the panel posts closeSidePanel", async () => {
    render(ExerciseSubmission, { props: { panel } })
    postedMessages.mockClear()
    await clickToolbarButton("Close")
    expect(postedMessages).toHaveBeenCalledWith({ type: "closeSidePanel" })
  })
})

suite("ExerciseSubmission panel (failures)", () => {
  test("replaces the progress with the failure and offers to submit again", async () => {
    render(ExerciseSubmission, { props: { panel } })
    showView(panel.id, submitFailedView({ message: "Failed to submit.", detailsId: "submit" }))

    expect(await screen.findByRole("heading", { name: "Submission failed" })).toBeInTheDocument()
    expect(screen.getByRole("alert")).toHaveTextContent("Failed to submit.")
    postedMessages.mockClear()
    await fireEvent.click(screen.getByRole("button", { name: "Show Details" }))
    expect(postedMessages).toHaveBeenCalledWith({ type: "showErrorDetails", detailsId: "submit" })
    expect(document.querySelector("vscode-progress-bar")).toBeNull()
    expect(screen.queryByText("Run in Background")).not.toBeInTheDocument()
    expect(isSecondary(screen.getByRole("button", { name: "Submit Again" }))).toBe(false)
    expect(isSecondary(screen.getByRole("button", { name: "Run Tests" }))).toBe(true)
    expect(screen.queryByText("Close", { selector: "vscode-button" })).not.toBeInTheDocument()
  })

  test("offers the failure's remedy", async () => {
    render(ExerciseSubmission, { props: { panel: moocPanel } })
    showView(
      moocPanel.id,
      submitFailedView({
        message: "Log in again.",
        actions: [{ label: "Log In", command: "tmc.showMoocLogin" }],
      }),
    )

    ;(await screen.findByRole("button", { name: "Log In" })).click()

    expect(postedMessages).toHaveBeenCalledWith({
      type: "runCommand",
      command: "tmc.showMoocLogin",
    })
  })

  test("announces whether the host managed to copy the server's output", async () => {
    vi.useFakeTimers()
    try {
      render(ExerciseSubmission, { props: { panel } })
      showTmcResult(
        submissionFinished({ status: "error", all_tests_passed: null, error: "ECONNRESET" }),
      )
      await vi.runAllTimersAsync()
      const copy = await withinShadowRoot(screen.getByTitle("Copy Server output"))
      await fireEvent.click(copy.getByRole("button"))
      expect(postedMessages).toHaveBeenCalledWith({
        type: "copyToClipboard",
        requestId: expect.any(Number),
        sourcePanel: { id: panel.id, type: "ExerciseSubmission" },
        text: "ECONNRESET",
      })

      replyToRequest("copyToClipboard", { ok: false, error: { message: "no clipboard" } })
      await vi.runAllTimersAsync()

      expect(screen.getByTestId("announcer")).toHaveTextContent("Could not copy to the clipboard")
    } finally {
      vi.useRealTimers()
    }
  })

  test("shows the server's own explanation of a processing error", async () => {
    render(ExerciseSubmission, { props: { panel } })
    showTmcResult(
      submissionFinished({ status: "error", all_tests_passed: null, error: "Out of memory" }),
    )

    expect(
      await screen.findByRole("heading", { name: "The server could not process the submission" }),
    ).toBeInTheDocument()
    expect(screen.getByRole("group", { name: "Server output" })).toHaveTextContent("Out of memory")
  })
})

suite("ExerciseSubmission panel (teacher review)", () => {
  test("says the points come after the review, out of how many", async () => {
    render(ExerciseSubmission, { props: { panel } })
    showView(panel.id, {
      ...testedLocallyView(0),
      phase: "finished",
      headline: "All tests passed",
      explanation: undefined,
      heldPointsMax: 3,
    })

    expect(await screen.findByText("Points after review, out of 3")).toBeInTheDocument()
    expect(screen.queryByRole("meter", { name: "Points" })).not.toBeInTheDocument()
  })

  test("a result awaiting review leads on to the next exercise, as the course home does", async () => {
    render(ExerciseSubmission, { props: { panel } })
    showView(panel.id, {
      ...testedLocallyView(0),
      phase: "finished",
      headline: "All tests passed",
      explanation: undefined,
      heldPointsMax: 1,
      pendingReview: "The points wait for a teacher's review.",
      nextExercise: { name: "lists" },
    })

    expect(await screen.findByRole("button", { name: "Next: lists" })).toBeInTheDocument()
  })

  test("says what the review waits for beside the explanation", async () => {
    render(ExerciseSubmission, { props: { panel: moocPanel } })
    showView(moocPanel.id, {
      ...moocGradingView(moocGrading({ score_given: 3 }), 3),
      pendingReview: "A teacher reviews this answer, which can change the points.",
    })

    expect(
      await screen.findByText("A teacher reviews this answer, which can change the points."),
    ).toBeInTheDocument()
  })
})

suite("ExerciseSubmission panel (tmc results)", () => {
  test("shows the points against the exercise's available points", async () => {
    render(ExerciseSubmission, { props: { panel } })
    showTmcResult(submissionFinished({ points: ["1.1"] }))

    expect(await screen.findByRole("heading", { name: "Passed" })).toBeInTheDocument()
    expect(screen.getByRole("meter", { name: "Points" })).toHaveAttribute(
      "aria-valuetext",
      "1 / 2 points",
    )
  })

  test("keeps the submission and model solution links once the result is in", async () => {
    render(ExerciseSubmission, { props: { panel } })
    showTmcResult(submissionFinished({ solution_url: "https://tmc.mooc.fi/solutions/1" }))

    await screen.findByRole("heading", { name: "Passed" })
    postedMessages.mockClear()
    await chooseMenuItem("Show Submission in Browser")
    await chooseMenuItem("Show Model Solution")
    expect(postedMessages.mock.calls).toEqual([
      [{ type: "openLinkInBrowser", url: "https://tmc.mooc.fi/submissions/1" }],
      [{ type: "openLinkInBrowser", url: "https://tmc.mooc.fi/solutions/1" }],
    ])
  })

  test("a failed test run lists the failure and offers paste help", async () => {
    render(ExerciseSubmission, { props: { panel } })
    showTmcResult(
      submissionFinished({
        status: "fail",
        all_tests_passed: false,
        points: [],
        test_cases: [
          {
            name: "test_sum",
            successful: false,
            message: "Expected 3",
            detailed_message: null,
            exception: null,
          },
        ],
      }),
    )

    expect(await screen.findByRole("heading", { name: "Not passed" })).toBeInTheDocument()
    expect(screen.getByText("0 of 1 tests passed")).toBeInTheDocument()
    expect(await menuItems()).toContain("Get Help")
  })

  test("asking for help opens the Get Help section and moves focus to it", async () => {
    render(ExerciseSubmission, { props: { panel } })
    showTmcResult(submissionFinished({ status: "fail", all_tests_passed: false, points: [] }))
    await screen.findByRole("heading", { name: "Not passed" })
    const toggle = screen.getByRole("button", { name: "Get Help" })
    expect(toggle).toHaveAttribute("aria-expanded", "false")

    await chooseMenuItem("Get Help")

    expect(toggle).toHaveAttribute("aria-expanded", "true")
    expect(toggle).toHaveFocus()
  })

  test("a passed submission shows no Get Help section, but More Actions still opens it", async () => {
    render(ExerciseSubmission, { props: { panel } })
    showTmcResult(submissionFinished())

    await screen.findByRole("heading", { name: "Passed" })
    expect(screen.queryByRole("button", { name: "Get Help" })).not.toBeInTheDocument()

    await chooseMenuItem("Get Help")

    expect(screen.getByRole("button", { name: "Get Help" })).toHaveAttribute(
      "aria-expanded",
      "true",
    )
  })

  test("help asked for on a failed result is put away once a later one passes", async () => {
    render(ExerciseSubmission, { props: { panel } })
    showTmcResult(submissionFinished({ status: "fail", all_tests_passed: false, points: [] }))
    await screen.findByRole("heading", { name: "Not passed" })
    await chooseMenuItem("Get Help")
    expect(screen.getByRole("button", { name: "Get Help" })).toHaveAttribute(
      "aria-expanded",
      "true",
    )

    showTmcResult(submissionFinished())

    await screen.findByRole("heading", { name: "Passed" })
    expect(screen.queryByRole("button", { name: "Get Help" })).not.toBeInTheDocument()
    await chooseMenuItem("Get Help")
    expect(screen.getByRole("button", { name: "Get Help" })).toHaveAttribute(
      "aria-expanded",
      "true",
    )
  })

  test("valgrind output is available behind a disclosure", async () => {
    render(ExerciseSubmission, { props: { panel } })
    showTmcResult(submissionFinished({ valgrind: "==1== definitely lost: 8 bytes" }))

    await fireEvent.click(await screen.findByRole("button", { name: "Valgrind output" }))
    expect(screen.getByRole("group", { name: "Valgrind output" })).toHaveTextContent(
      "definitely lost: 8 bytes",
    )
  })
})

/** Answers the feedback form's text question and sends it. */
async function sendFeedback(): Promise<void> {
  const textarea = document.querySelector("vscode-textarea")!
  textarea.value = "Fun exercise"
  await fireEvent.input(textarea)
  ;(await screen.findByRole("button", { name: "Send feedback" })).click()
}

suite("ExerciseSubmission panel (tmc feedback)", () => {
  const questions: FeedbackQuestion[] = [
    { id: 1, kind: "intrange", lower: 1, upper: 5, question: "How difficult was this?" },
    { id: 2, kind: "text", question: "Free feedback" },
  ]

  async function renderWithFeedback(): Promise<void> {
    render(ExerciseSubmission, { props: { panel } })
    showTmcResult(submissionFinished({ feedback_answer_url: FEEDBACK_URL }), questions)
    await screen.findByRole("heading", { name: "Give feedback" })
  }

  test("asks the course's questions and sends the answered ones", async () => {
    await renderWithFeedback()
    expect(screen.getByRole("radiogroup", { name: "How difficult was this?" })).toBeInTheDocument()
    const send = await screen.findByRole("button", { name: "Send feedback" })
    expect(send).toHaveAttribute("disabled")

    const textarea = document.querySelector("vscode-textarea")!
    textarea.value = "Fun exercise"
    await fireEvent.input(textarea)
    postedMessages.mockClear()
    send.click()

    expect(postedMessages).toHaveBeenCalledWith({
      type: "sendFeedback",
      requestId: expect.any(Number),
      sourcePanel: { id: panel.id, type: "ExerciseSubmission" },
      answers: [{ questionId: 2, answer: "Fun exercise" }],
    })
  })

  test("a chosen rating is sent as its number", async () => {
    await renderWithFeedback()
    const radio = [...document.querySelectorAll("vscode-radio")].find((r) => r.value === "4")!
    radio.checked = true
    radio.dispatchEvent(new Event("change", { bubbles: true }))

    postedMessages.mockClear()
    ;(await screen.findByRole("button", { name: "Send feedback" })).click()
    expect(postedMessages).toHaveBeenCalledWith(
      expect.objectContaining({ answers: [{ questionId: 1, answer: "4" }] }),
    )
  })

  test("thanks the student once the host marks the feedback sent", async () => {
    await renderWithFeedback()
    await sendFeedback()
    replyToRequest("sendFeedback", { ok: true })
    showView(
      panel.id,
      feedbackSent(
        tmcResultView(submissionFinished({ feedback_answer_url: FEEDBACK_URL }), questions, 2),
      ),
    )

    expect(await screen.findByText("Thank you for your feedback.")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Send feedback" })).not.toBeInTheDocument()
  })

  test("a failed send keeps the form and says why", async () => {
    await renderWithFeedback()
    await sendFeedback()
    replyToRequest("sendFeedback", { ok: false, error: { message: "connection reset" } })

    expect(await screen.findByRole("alert")).toHaveTextContent("connection reset")
    expect(await screen.findByRole("button", { name: "Send feedback" })).toBeInTheDocument()
  })

  test("no questions, no form", async () => {
    render(ExerciseSubmission, { props: { panel } })
    showTmcResult(submissionFinished({ feedback_answer_url: FEEDBACK_URL }))

    await screen.findByRole("heading", { name: "Passed" })
    expect(screen.queryByRole("heading", { name: "Give feedback" })).not.toBeInTheDocument()
  })
})

suite("ExerciseSubmission panel (mooc results)", () => {
  test("renders the graded status, score out of the maximum and feedback text", async () => {
    render(ExerciseSubmission, { props: { panel: moocPanel } })
    showMoocGrading(
      moocGrading({
        score_given: 2.666666,
        feedback_text: "Great work",
        exercise_progress: {
          exercise_id: "exercise",
          score_given: 2.666666,
          score_maximum: 3,
          completed: true,
          attempted: true,
          standing: "Attempted",
          max_tries: null,
          tries_left: null,
          pending_teacher_review: null,
          exercise_locked: false,
          reviewing_stage: null,
          teacher_review: null,
        },
      }),
    )

    expect(await screen.findByRole("heading", { name: "Not passed" })).toBeInTheDocument()
    expect(screen.getByRole("meter", { name: "Points" })).toHaveAttribute(
      "aria-valuetext",
      "2.67 / 3 points",
    )
    expect(screen.getByText("Grader feedback:").parentElement).toHaveTextContent(
      "Grader feedback: Great work",
    )
    expect(
      screen.queryByText(/tests? (passed|failed)/i, { ignore: "h1, h2, h3, script, style" }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText("Run in Background")).not.toBeInTheDocument()
  })

  test("a partial score shows the Get Help section, a full one only offers it in More Actions", async () => {
    const { unmount } = render(ExerciseSubmission, { props: { panel: moocPanel } })
    showMoocGrading(moocGrading({ score_given: 1 }))
    await screen.findByRole("heading", { name: "Not passed" })
    expect(screen.getByRole("button", { name: "Get Help" })).toBeInTheDocument()
    expect(await menuItems()).toContain("Get Help")
    unmount()

    render(ExerciseSubmission, { props: { panel: moocPanel } })
    showMoocGrading(
      moocGrading({
        score_given: 3,
        exercise_progress: {
          exercise_id: "exercise",
          score_given: 3,
          score_maximum: 3,
          completed: true,
          attempted: true,
          standing: "Passed",
          max_tries: null,
          tries_left: null,
          pending_teacher_review: null,
          exercise_locked: false,
          reviewing_stage: null,
          teacher_review: null,
        },
      }),
    )
    await screen.findByRole("heading", { name: "Passed" })
    expect(screen.queryByRole("button", { name: "Get Help" })).not.toBeInTheDocument()
    expect(await menuItems()).toContain("Get Help")
  })

  test("the last try below full points says the score is final", async () => {
    render(ExerciseSubmission, { props: { panel: moocPanel } })
    showMoocGrading(
      moocGrading({
        score_given: 2,
        exercise_progress: {
          exercise_id: "exercise",
          score_given: 2,
          score_maximum: 3,
          completed: true,
          attempted: true,
          standing: "OutOfTries",
          max_tries: null,
          tries_left: null,
          pending_teacher_review: null,
          exercise_locked: false,
          reviewing_stage: null,
          teacher_review: null,
        },
      }),
    )
    await screen.findByRole("heading", { name: "Not passed" })
    expect(screen.getByText("That was your last try, so this score is final.")).toBeInTheDocument()
  })

  test("a pass leads on to the next exercise as the only button", async () => {
    render(ExerciseSubmission, { props: { panel } })
    showView(panel.id, {
      ...tmcResultView(submissionFinished({ all_tests_passed: true }), [], 2),
      isExercisePassed: true,
      nextExercise: { name: "part01-02_world" },
    })
    postedMessages.mockClear()

    const next = await screen.findByRole("button", { name: "Next: part01-02_world" })
    expect(isSecondary(next)).toBe(false)
    expect(document.querySelectorAll("vscode-button")).toHaveLength(1)
    next.click()

    expect(postedMessages).toHaveBeenCalledWith({
      type: "exerciseAction",
      sourcePanel: { id: panel.id, type: panel.type },
      action: "openNextExercise",
    })
  })

  test("a failing submission after a pass keeps the points out of it, and offers a retry", async () => {
    render(ExerciseSubmission, { props: { panel } })
    showView(panel.id, {
      ...moocGradingView(
        moocGrading({
          score_given: 0,
          exercise_progress: {
            exercise_id: "exercise",
            score_given: 1,
            score_maximum: 1,
            completed: true,
            attempted: true,
            standing: "Passed",
            max_tries: null,
            tries_left: null,
            pending_teacher_review: null,
            exercise_locked: false,
            reviewing_stage: null,
            teacher_review: null,
          },
        }),
        1,
      ),
      isExercisePassed: true,
      nextExercise: { name: "part01-02_world" },
    })

    await screen.findByRole("heading", { name: "Passed" })
    expect(screen.getByText(/This submission failed some tests/)).toBeInTheDocument()
    expect(screen.queryByRole("meter", { name: "Points" })).not.toBeInTheDocument()
    expect(isSecondary(screen.getByRole("button", { name: "Next: part01-02_world" }))).toBe(false)
    expect(isSecondary(screen.getByRole("button", { name: "Run Tests" }))).toBe(true)
    expect(isSecondary(screen.getByRole("button", { name: "Submit Again" }))).toBe(true)
  })

  test("a result short of a pass offers to test and submit again", async () => {
    render(ExerciseSubmission, { props: { panel } })
    showView(panel.id, {
      ...tmcResultView(submissionFinished({ all_tests_passed: false }), [], 2),
      isExercisePassed: false,
    })
    postedMessages.mockClear()

    const runTests = await screen.findByRole("button", { name: "Run Tests" })
    const submitAgain = screen.getByRole("button", { name: "Submit Again" })
    expect(isSecondary(runTests)).toBe(false)
    expect(isSecondary(submitAgain)).toBe(true)
    runTests.click()
    submitAgain.click()

    expect(postedMessages.mock.calls.map(([message]) => message.action)).toEqual([
      "runTests",
      "submit",
    ])
    expect(screen.queryByRole("button", { name: /^Next:/ })).not.toBeInTheDocument()
  })

  test("an exercise gone from disk offers to open it again, not to test or submit it", async () => {
    render(ExerciseSubmission, { props: { panel } })
    showView(panel.id, {
      ...tmcResultView(submissionFinished({ all_tests_passed: false }), [], 2),
      isExercisePassed: false,
      exerciseState: "notOnDisk",
    })
    postedMessages.mockClear()

    const open = await screen.findByRole("button", { name: "Open Exercise" })
    expect(screen.getByText(/no longer on this computer/)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Run Tests" })).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Submit Again" })).not.toBeInTheDocument()
    open.click()

    expect(postedMessages).toHaveBeenCalledWith({
      type: "exerciseAction",
      sourcePanel: { id: panel.id, type: panel.type },
      action: "openExercise",
    })
  })

  test("an exercise removed from its course can be tested but not submitted again", async () => {
    render(ExerciseSubmission, { props: { panel } })
    showView(panel.id, {
      ...tmcResultView(submissionFinished({ all_tests_passed: false }), [], 2),
      isExercisePassed: false,
      exerciseState: "removed",
    })

    expect(await screen.findByRole("button", { name: "Run Tests" })).toBeInTheDocument()
    expect(screen.getByText(/removed from the course/)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Submit Again" })).not.toBeInTheDocument()
  })

  test("an exercise the backend would refuse says why, and leads to the model solution instead", async () => {
    render(ExerciseSubmission, { props: { panel } })
    showView(panel.id, {
      ...tmcResultView(submissionFinished({ all_tests_passed: false }), [], 2),
      isExercisePassed: false,
      solutionUrl: "https://courses.example/solution",
      submitRefusal: "You have no tries left on loops, so it can no longer be submitted.",
      triesLeft: 0,
    })
    postedMessages.mockClear()

    const solution = await screen.findByRole("button", { name: "Show Model Solution" })
    expect(isSecondary(solution)).toBe(true)
    expect(screen.getByText(/no tries left on loops/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Run Tests" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Submit Again" })).not.toBeInTheDocument()
    solution.click()

    expect(postedMessages).toHaveBeenCalledWith({
      type: "openLinkInBrowser",
      url: "https://courses.example/solution",
    })
  })

  test("counts the tries left while another submission is accepted", async () => {
    render(ExerciseSubmission, { props: { panel } })
    showView(panel.id, {
      ...tmcResultView(submissionFinished({ all_tests_passed: false }), [], 2),
      isExercisePassed: false,
      triesLeft: 1,
    })

    expect(await screen.findByText("1 try left on this exercise.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Submit Again" })).toBeInTheDocument()
  })

  test("awaiting manual grading explains itself and asks nothing of the student", async () => {
    render(ExerciseSubmission, { props: { panel: moocPanel } })
    showMoocGrading(moocGrading({ grading_progress: "PendingManual" }))

    expect(await screen.findByText(/A teacher will grade this submission/)).toBeInTheDocument()
    expect(screen.queryByText("Run in Background")).not.toBeInTheDocument()
    expect(screen.queryByText("Keep Waiting")).not.toBeInTheDocument()
    expect(document.querySelectorAll("vscode-button")).toHaveLength(0)
  })

  for (const [name, status] of [
    ["grading still pending", moocGrading({ grading_progress: "Pending" })],
    ["grading not ready", moocGrading({ grading_progress: "NotReady" })],
    ["no grading yet", { status: "no-grading-yet" }],
  ] as const) {
    test(`${name}: offers Keep Waiting`, async () => {
      render(ExerciseSubmission, { props: { panel: moocPanel } })
      showMoocGrading(status)

      expect(await screen.findByText(/VS Code stopped waiting/)).toBeInTheDocument()
      const keepWaiting = screen.getByRole("button", { name: "Keep Waiting" })
      expect(isSecondary(keepWaiting)).toBe(false)
      expect(screen.queryByText("Run in Background")).not.toBeInTheDocument()
    })
  }

  test("Keep Waiting asks the host to wait for the grading again", async () => {
    render(ExerciseSubmission, { props: { panel: moocPanel } })
    showMoocGrading(moocGrading({ grading_progress: "Pending" }))
    postedMessages.mockClear()

    ;(await screen.findByRole("button", { name: "Keep Waiting" })).click()

    expect(postedMessages).toHaveBeenCalledWith({
      type: "keepWaitingForGrading",
      requestId: expect.any(Number),
      sourcePanel: { id: moocPanel.id, type: "ExerciseSubmission" },
    })
    expect(await screen.findByRole("button", { name: "Keep Waiting" })).toHaveAttribute("disabled")

    showView(moocPanel.id, inProgressView("grading", { steps: ["Grading in progress"] }))
    expect(await screen.findByRole("button", { name: "Run in Background" })).toBeInTheDocument()
  })

  test("a refused Keep Waiting says why", async () => {
    render(ExerciseSubmission, { props: { panel: moocPanel } })
    showView(moocPanel.id, gradingUnavailableView({ message: "offline" }))
    ;(await screen.findByRole("button", { name: "Keep Waiting" })).click()

    replyToRequest("keepWaitingForGrading", {
      ok: false,
      error: { message: "Already waiting for this submission's grading." },
    })

    expect(
      await screen.findByText("Already waiting for this submission's grading."),
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Keep Waiting" })).not.toHaveAttribute("disabled")
  })
})

// VS Code reloads the document of a panel that was hidden; the host sends the panel and its
// latest view again, and the webview state keeps what only the webview knew.
const tmcExercise = (passed: boolean) =>
  makeTmcKind({
    id: 1,
    name: "part01-01_hello",
    availablePoints: 2,
    awardedPoints: passed ? 2 : 0,
    passed,
    deadline: null,
    softDeadline: null,
  })

function openSection(
  section: "history" | "getHelp",
  serial: number,
  shouldPaste = false,
  shown: ExerciseSubmissionPanel = panel,
): void {
  dispatchToWebview({
    type: "openExerciseSection",
    target: { id: shown.id, type: shown.type },
    section,
    serial,
    shouldPaste,
  })
}

suite("ExerciseSubmission panel (results hub)", () => {
  test("without a submission, shows where the exercise stands and offers to test it", async () => {
    render(ExerciseSubmission, { props: { panel } })
    showView(panel.id, standingView(tmcExercise(false), undefined))

    expect(await screen.findByRole("heading", { name: "Not passed" })).toBeInTheDocument()
    expect(screen.getByRole("meter", { name: "Points" })).toBeInTheDocument()
    const runTests = screen.getByRole("button", { name: "Run Tests" })
    const submit = screen.getByRole("button", { name: "Submit" })
    expect(isSecondary(runTests)).toBe(false)
    expect(isSecondary(submit)).toBe(true)
  })

  test("a submitted exercise not passed reads as right after its grading, with Submit Again", async () => {
    render(ExerciseSubmission, { props: { panel } })
    showView(
      panel.id,
      standingView(makeTmcKind({ ...unwrap(tmcExercise(false)), attempted: true }), undefined),
    )

    const banner = (await screen.findByRole("heading", { name: "Not passed" })).closest("section")
    expect(banner).toHaveClass("tone-failed")
    expect(screen.getByRole("button", { name: "Submit Again" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Submit" })).toBeNull()
  })

  test("a passed exercise leads on, with its model solution beside", async () => {
    render(ExerciseSubmission, { props: { panel } })
    showView(panel.id, {
      ...standingView(tmcExercise(true), "https://tmc.mooc.fi/exercises/1/solution"),
      nextExercise: { name: "part01-02_name" },
    })

    expect(await screen.findByRole("heading", { name: "Passed" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Next: part01-02_name" })).toBeInTheDocument()
    expect(isSecondary(screen.getByRole("button", { name: "Show Model Solution" }))).toBe(true)
    expect(screen.queryByRole("button", { name: "Submit" })).not.toBeInTheDocument()
    expect(await menuItems()).not.toContain("Show Model Solution")
  })

  test("the last exercise passed offers its model solution, never as the main action", async () => {
    render(ExerciseSubmission, { props: { panel } })
    showView(panel.id, standingView(tmcExercise(true), "https://tmc.mooc.fi/exercises/1/solution"))

    const solution = await screen.findByRole("button", { name: "Show Model Solution" })
    expect(isSecondary(solution)).toBe(true)
    expect(await menuItems()).not.toContain("Open Course Material")
  })

  test("without a model solution, More Actions opens the course material instead", async () => {
    render(ExerciseSubmission, { props: { panel } })
    showView(panel.id, {
      ...standingView(tmcExercise(true), undefined),
      materialUrl: "https://courses.example/page",
    })
    await screen.findByRole("heading", { name: "Passed" })
    expect(screen.queryByRole("button", { name: "Show Model Solution" })).not.toBeInTheDocument()
    postedMessages.mockClear()

    await chooseMenuItem("Open Course Material")

    expect(postedMessages).toHaveBeenCalledWith({
      type: "openLinkInBrowser",
      url: "https://courses.example/page",
    })
  })

  test("all tests passing locally makes Submit the main action", async () => {
    render(ExerciseSubmission, { props: { panel } })
    showView(panel.id, testedLocallyView(LOCAL_PASS_AT))
    const submit = await screen.findByRole("button", { name: "Submit" })
    postedMessages.mockClear()

    expect(screen.getByRole("heading", { name: "Tests pass on your computer" })).toBeInTheDocument()
    expect(isSecondary(submit)).toBe(false)
    submit.click()

    expect(postedMessages).toHaveBeenCalledWith({
      type: "exerciseAction",
      sourcePanel: { id: panel.id, type: panel.type },
      action: "submit",
    })
  })

  test("a local pass asks to submit, and Not Now dismisses the question for that run", async () => {
    render(ExerciseSubmission, { props: { panel } })
    showView(panel.id, testedLocallyView(LOCAL_PASS_AT))

    const prompt = await screen.findByRole("group", { name: "All tests pass. Submit for grading?" })
    expect(within(prompt).getByRole("button", { name: "Submit" })).toBeInTheDocument()
    expect(screen.queryByText("Submit the exercise to have it graded.")).not.toBeInTheDocument()
    await fireEvent.click(within(prompt).getByRole("button", { name: "Not Now" }))
    await tick()

    expect(screen.queryByRole("group", { name: /Submit for grading/ })).not.toBeInTheDocument()
    expect(screen.queryByText("All tests pass. Submit for grading?")).not.toBeInTheDocument()
    expect(isSecondary(screen.getByRole("button", { name: "Submit" }))).toBe(true)
    expect(isSecondary(screen.getByRole("button", { name: "Run Tests" }))).toBe(false)
    expect(screen.getByRole("button", { name: "Run Tests" })).toHaveFocus()

    showView(panel.id, testedLocallyView(LOCAL_PASS_AT))
    await tick()
    expect(screen.queryByRole("group", { name: /Submit for grading/ })).not.toBeInTheDocument()

    showView(panel.id, testedLocallyView(LOCAL_PASS_AT + 1))
    expect(
      await screen.findByRole("group", { name: "All tests pass. Submit for grading?" }),
    ).toBeInTheDocument()
  })

  test.each([
    ["logged out", { isLoggedOut: true }],
    [
      "refused",
      { submitRefusal: "You have no tries left on loops, so it can no longer be submitted." },
    ],
    ["not on disk", { exerciseState: "notOnDisk" as const }],
  ])("a local pass does not ask to submit when %s", async (_state, overrides) => {
    render(ExerciseSubmission, { props: { panel } })
    showView(panel.id, { ...testedLocallyView(LOCAL_PASS_AT), ...overrides })

    await screen.findByRole("heading", { name: "Tests pass on your computer" })
    expect(screen.queryByText("All tests pass. Submit for grading?")).not.toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Not Now" })).not.toBeInTheDocument()
  })

  test("logged out, a local pass offers to log in and submit as its main action", async () => {
    render(ExerciseSubmission, { props: { panel } })
    showView(panel.id, { ...testedLocallyView(LOCAL_PASS_AT), isLoggedOut: true })
    const logIn = await screen.findByRole("button", { name: "Log In to Submit" })
    postedMessages.mockClear()

    expect(isSecondary(logIn)).toBe(false)
    expect(screen.queryByRole("button", { name: "Submit" })).not.toBeInTheDocument()
    logIn.click()

    expect(postedMessages).toHaveBeenCalledWith({
      type: "exerciseAction",
      sourcePanel: { id: panel.id, type: panel.type },
      action: "logInToSubmit",
    })
  })

  test("a submission failed on a lost session offers one Log In, Log In to Submit", async () => {
    render(ExerciseSubmission, { props: { panel } })
    showView(panel.id, {
      ...submitFailedView({
        message: "You were logged out. Log in again.",
        actions: [{ label: "Log In", command: "tmc.showMoocLogin" }],
      }),
      isLoggedOut: true,
    })

    expect(await screen.findByRole("alert")).toHaveTextContent("You were logged out.")
    expect(screen.getByRole("button", { name: "Log In to Submit" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Log In" })).not.toBeInTheDocument()
  })

  test("a local pass of an exercise that cannot be submitted says why instead of offering Submit", async () => {
    render(ExerciseSubmission, { props: { panel } })
    showView(panel.id, {
      ...testedLocallyView(LOCAL_PASS_AT),
      submitRefusal:
        "The deadline of part01-01_hello has passed, so it can no longer be submitted.",
    })

    expect(await screen.findByText(/deadline of part01-01_hello has passed/)).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Submit" })).not.toBeInTheDocument()
  })

  test("History stays closed, and lists nothing, until opened", async () => {
    render(ExerciseSubmission, { props: { panel } })
    showView(panel.id, standingView(tmcExercise(false), undefined))
    const toggle = await screen.findByRole("button", { name: "History" })

    expect(toggle).toHaveAttribute("aria-expanded", "false")
    expect(postedMessages).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "requestSubmissionHistory" }),
    )
    toggle.click()

    await vi.waitFor(() =>
      expect(postedMessages).toHaveBeenCalledWith(
        expect.objectContaining({ type: "requestSubmissionHistory" }),
      ),
    )
  })

  test("History's refresh, in its header while open, lists the submissions again", async () => {
    render(ExerciseSubmission, { props: { panel } })
    showView(panel.id, standingView(tmcExercise(false), undefined))
    const toggle = await screen.findByRole("button", { name: "History" })
    expect(screen.queryByTitle("Refresh History")).not.toBeInTheDocument()
    toggle.click()
    await vi.waitFor(() =>
      expect(postedMessages).toHaveBeenCalledWith(
        expect.objectContaining({ type: "requestSubmissionHistory" }),
      ),
    )
    replyToRequest("requestSubmissionHistory", { ok: true, value: [] })
    await screen.findByText("No earlier submissions yet.")
    postedMessages.mockClear()

    const refresh = await withinShadowRoot(screen.getByTitle("Refresh History"))
    refresh.getByRole("button").click()

    await vi.waitFor(() =>
      expect(postedMessages).toHaveBeenCalledWith(
        expect.objectContaining({ type: "requestSubmissionHistory" }),
      ),
    )
  })

  test("a command's request opens History and moves the focus to it", async () => {
    render(ExerciseSubmission, { props: { panel } })
    showView(panel.id, standingView(tmcExercise(false), undefined))
    await screen.findByRole("heading", { name: "Not passed" })

    openSection("history", 1)

    const toggle = screen.getByRole("button", { name: "History" })
    await vi.waitFor(() => expect(toggle).toHaveFocus())
    expect(toggle).toHaveAttribute("aria-expanded", "true")
    expect(postedMessages).toHaveBeenCalledWith(
      expect.objectContaining({ type: "requestSubmissionHistory" }),
    )
  })

  test("the menu opens History too", async () => {
    render(ExerciseSubmission, { props: { panel } })
    showView(panel.id, standingView(tmcExercise(false), undefined))
    await screen.findByRole("heading", { name: "Not passed" })

    await chooseMenuItem("History")

    expect(screen.getByRole("button", { name: "History" })).toHaveAttribute("aria-expanded", "true")
  })

  test("an exercise gone from disk lists its History without Restore", async () => {
    render(ExerciseSubmission, { props: { panel } })
    showView(panel.id, {
      ...standingView(tmcExercise(false), undefined),
      exerciseState: "notOnDisk",
    })
    await screen.findByRole("heading", { name: "Not passed" })

    openSection("history", 1)

    expect(await screen.findByText(/Open the exercise again to restore/)).toBeInTheDocument()
  })

  test("an exercise removed from its course has no History", async () => {
    render(ExerciseSubmission, { props: { panel } })
    showView(panel.id, { ...standingView(tmcExercise(false), undefined), exerciseState: "removed" })
    await screen.findByRole("heading", { name: "Not passed" })

    expect(screen.queryByRole("button", { name: "History" })).not.toBeInTheDocument()
    expect(await menuItems()).not.toContain("History")
  })

  test("Get Help opens its section and sends the code there, once", async () => {
    render(ExerciseSubmission, { props: { panel } })
    showView(panel.id, standingView(tmcExercise(true), undefined))
    await screen.findByRole("heading", { name: "Passed" })
    expect(screen.queryByRole("button", { name: "Get Help" })).not.toBeInTheDocument()

    openSection("getHelp", 1, true)

    const toggle = await screen.findByRole("button", { name: "Get Help" })
    await vi.waitFor(() => expect(toggle).toHaveFocus())
    await vi.waitFor(() =>
      expect(
        postedMessages.mock.calls.filter(([message]) => message.type === "pasteExercise"),
      ).toHaveLength(1),
    )
    replyToRequest("pasteExercise", {
      ok: true,
      value: { link: "https://tmc.mooc.fi/paste/abc", isReused: false },
    })
    expect(await screen.findByText("https://tmc.mooc.fi/paste/abc")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Copy Link" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Open Link" })).toBeInTheDocument()
  })

  test("a section request resent after a reload does not send the code again", async () => {
    enterScreen(panel)
    render(ExerciseSubmission, { props: { panel } })
    showView(panel.id, standingView(tmcExercise(false), undefined))
    openSection("getHelp", 7, true)
    await vi.waitFor(() =>
      expect(postedMessages).toHaveBeenCalledWith(
        expect.objectContaining({ type: "pasteExercise" }),
      ),
    )

    reloadDocument()
    postedMessages.mockClear()
    enterScreen(panel)
    render(ExerciseSubmission, { props: { panel } })
    showView(panel.id, standingView(tmcExercise(false), undefined))
    openSection("getHelp", 7, true)
    await screen.findByRole("button", { name: "Get Help" })

    expect(postedMessages).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "pasteExercise" }),
    )
  })
})

suite("ExerciseSubmission panel shown again after being hidden", () => {
  const questions: FeedbackQuestion[] = [{ id: 2, kind: "text", question: "Free feedback" }]

  function showPanel(shown: ExerciseSubmissionPanel = panel): void {
    enterScreen(shown)
    render(ExerciseSubmission, { props: { panel: shown } })
    showView(
      shown.id,
      tmcResultView(
        submissionFinished({
          all_tests_passed: false,
          status: "fail",
          valgrind: "==1== definitely lost: 8 bytes",
          feedback_answer_url: FEEDBACK_URL,
        }),
        questions,
        2,
      ),
    )
  }

  test("keeps an opened disclosure open", async () => {
    showPanel()
    await fireEvent.click(await screen.findByRole("button", { name: "Valgrind output" }))

    reloadDocument()
    showPanel()

    expect(await screen.findByRole("button", { name: "Valgrind output" })).toHaveAttribute(
      "aria-expanded",
      "true",
    )
  })

  test("keeps a feedback draft", async () => {
    showPanel()
    await screen.findByRole("heading", { name: "Give feedback" })
    const textarea = document.querySelector("vscode-textarea")!
    textarea.value = "Half-written thought"
    await fireEvent.input(textarea)

    reloadDocument()
    showPanel()

    await screen.findByRole("heading", { name: "Give feedback" })
    expect(document.querySelector("vscode-textarea")?.value).toBe("Half-written thought")
  })

  test("still shows the paste link the host answered with", async () => {
    showPanel()
    await chooseMenuItem("Get Help")
    ;(await screen.findByRole("button", { name: "Send to Pastebin" })).click()
    replyToRequest("pasteExercise", {
      ok: true,
      value: { link: "https://tmc.mooc.fi/paste/abc", isReused: false },
    })
    await screen.findByText(/https:\/\/tmc\.mooc\.fi\/paste\/abc/)

    reloadDocument()
    showPanel()

    expect(await screen.findByText(/https:\/\/tmc\.mooc\.fi\/paste\/abc/)).toBeInTheDocument()
  })

  test("a new submission of the same exercise starts with nothing kept", async () => {
    showPanel()
    await fireEvent.click(await screen.findByRole("button", { name: "Valgrind output" }))

    reloadDocument()
    showPanel({ ...panel, id: panel.id + 100 })

    expect(await screen.findByRole("button", { name: "Valgrind output" })).toHaveAttribute(
      "aria-expanded",
      "false",
    )
  })
})
