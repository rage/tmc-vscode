import { fireEvent, render, screen } from "@testing-library/svelte"

import {
  gradingUnavailableView,
  inProgressView,
  moocGradingView,
  submitFailedView,
  tmcResultView,
} from "../../../src/panels/submissionView"
import type { ExerciseTaskSubmissionStatus, SubmissionFinished } from "../shared/langsSchema"
import type { ExerciseSubmissionPanel, FeedbackQuestion, SubmissionView } from "../shared/shared"
import { BaseError, toWebviewError } from "../shared/shared"
import { dispatchToWebview, postedMessages, reloadDocument, replyToRequest } from "../test/setup"
import { withinShadowRoot } from "../test/shadow"
import { enterScreen } from "../utilities/uiState.svelte"
import ExerciseSubmission from "./ExerciseSubmission.svelte"

const panel: ExerciseSubmissionPanel = {
  id: 12,
  type: "ExerciseSubmission",
  backend: "tmc",
  courseSlug: "python-course",
  exerciseSlug: "part01-01_hello",
}

const moocPanel: ExerciseSubmissionPanel = {
  id: 13,
  type: "ExerciseSubmission",
  backend: "mooc",
  courseSlug: "mooc-course",
  exerciseSlug: "mooc-exercise",
}

const FEEDBACK_URL = "https://tmc.mooc.fi/api/v8/core/submissions/1/feedback"

function submissionFinished(overrides: Partial<SubmissionFinished> = {}): SubmissionFinished {
  return {
    api_version: 7,
    all_tests_passed: true,
    user_id: 1,
    login: "student",
    course: "python-course",
    exercise_name: "part01-01_hello",
    status: "ok",
    points: ["1.1"],
    valgrind: null,
    submission_url: "https://tmc.mooc.fi/submissions/1",
    solution_url: null,
    submitted_at: "2026-09-29T00:00:00Z",
    processing_time: 1,
    reviewed: false,
    requests_review: false,
    paste_url: null,
    message_for_paste: null,
    missing_review_points: [],
    test_cases: [],
    feedback_questions: null,
    feedback_answer_url: null,
    error: null,
    validations: null,
    ...overrides,
  }
}

function moocGrading(
  overrides: Partial<Extract<ExerciseTaskSubmissionStatus, { status: "grading" }>["grading"]>,
): ExerciseTaskSubmissionStatus {
  return {
    status: "grading",
    grading: {
      grading_progress: "FullyGraded",
      score_given: null,
      grading_started_at: null,
      grading_completed_at: null,
      feedback_text: null,
      ...overrides,
    },
  }
}

function showView(panelId: number, view: SubmissionView): void {
  dispatchToWebview({
    type: "submissionView",
    target: { type: "ExerciseSubmission", id: panelId },
    view,
  })
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
    expect(document.querySelector("vscode-progress-bar")).not.toBeNull()
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

  test("offers Run in background, and the submission's page once there is one", async () => {
    render(ExerciseSubmission, { props: { panel } })
    showView(
      panel.id,
      inProgressView("grading", { steps: [], submissionUrl: "https://tmc.mooc.fi/submissions/1" }),
    )

    const background = await screen.findByRole("button", { name: "Run in background" })
    expect(background).not.toHaveAttribute("secondary")
    postedMessages.mockClear()
    screen.getByRole("button", { name: "Show submission in browser" }).click()
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
  test("replaces the progress with the failure and offers Close", async () => {
    render(ExerciseSubmission, { props: { panel } })
    showView(
      panel.id,
      submitFailedView(toWebviewError(new BaseError("Failed to submit", "ECONNRESET"))),
    )

    expect(await screen.findByRole("heading", { name: "Submission failed" })).toBeInTheDocument()
    expect(screen.getByRole("alert")).toHaveTextContent("Failed to submit")
    expect(screen.getByRole("alert")).toHaveTextContent("ECONNRESET")
    expect(document.querySelector("vscode-progress-bar")).toBeNull()
    expect(screen.queryByText("Run in background")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument()
  })

  test("announces whether the host managed to copy the error details", async () => {
    vi.useFakeTimers()
    try {
      render(ExerciseSubmission, { props: { panel } })
      showView(panel.id, submitFailedView({ message: "Failed", details: "ECONNRESET" }))
      await vi.runAllTimersAsync()
      const copy = await withinShadowRoot(screen.getByTitle("Copy Error details"))
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
    expect(screen.getByRole("group", { name: "Error details" })).toHaveTextContent("Out of memory")
  })
})

suite("ExerciseSubmission panel (tmc results)", () => {
  test("shows the points against the exercise's available points", async () => {
    render(ExerciseSubmission, { props: { panel } })
    showTmcResult(submissionFinished({ points: ["1.1"] }))

    expect(
      await screen.findByRole("heading", { name: "All tests passed on the server" }),
    ).toBeInTheDocument()
    expect(screen.getByRole("meter", { name: "Points" })).toHaveAttribute(
      "aria-valuetext",
      "1 / 2 points",
    )
  })

  test("keeps the submission and model solution links once the result is in", async () => {
    render(ExerciseSubmission, { props: { panel } })
    showTmcResult(submissionFinished({ solution_url: "https://tmc.mooc.fi/solutions/1" }))

    const show = await screen.findByRole("button", { name: "Show submission in browser" })
    postedMessages.mockClear()
    show.click()
    screen.getByRole("button", { name: "Show model solution in browser" }).click()
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

    expect(
      await screen.findByRole("heading", { name: "Some tests failed on the server" }),
    ).toBeInTheDocument()
    expect(screen.getByText("0 of 1 tests passed")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Need help?" })).toBeInTheDocument()
  })

  test("a passed submission offers no paste help", async () => {
    render(ExerciseSubmission, { props: { panel } })
    showTmcResult(submissionFinished())

    await screen.findByRole("heading", { name: "All tests passed on the server" })
    expect(screen.queryByRole("button", { name: "Need help?" })).not.toBeInTheDocument()
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

    await screen.findByRole("heading", { name: "All tests passed on the server" })
    expect(screen.queryByRole("heading", { name: "Give feedback" })).not.toBeInTheDocument()
  })
})

suite("ExerciseSubmission panel (mooc results)", () => {
  test("renders the graded status, score out of the maximum and feedback text", async () => {
    render(ExerciseSubmission, { props: { panel: moocPanel } })
    showMoocGrading(moocGrading({ score_given: 2.666666, feedback_text: "Great work" }))

    expect(await screen.findByRole("heading", { name: "Exercise graded" })).toBeInTheDocument()
    expect(screen.getByRole("meter", { name: "Points" })).toHaveAttribute(
      "aria-valuetext",
      "2.67 / 3 points",
    )
    expect(screen.getByText("Great work")).toBeInTheDocument()
    expect(screen.queryByText(/tests? (passed|failed)/i)).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument()
    expect(screen.queryByText("Run in background")).not.toBeInTheDocument()
  })

  test("a partial score offers paste help, a full one does not", async () => {
    const { unmount } = render(ExerciseSubmission, { props: { panel: moocPanel } })
    showMoocGrading(moocGrading({ score_given: 1 }))
    expect(await screen.findByRole("button", { name: "Need help?" })).toBeInTheDocument()
    unmount()

    render(ExerciseSubmission, { props: { panel: moocPanel } })
    showMoocGrading(moocGrading({ score_given: 3 }))
    await screen.findByRole("heading", { name: "Exercise graded" })
    expect(screen.queryByRole("button", { name: "Need help?" })).not.toBeInTheDocument()
  })

  test("awaiting manual grading explains itself and offers Close", async () => {
    render(ExerciseSubmission, { props: { panel: moocPanel } })
    showMoocGrading(moocGrading({ grading_progress: "PendingManual" }))

    expect(await screen.findByText(/A teacher will grade this submission/)).toBeInTheDocument()
    expect(screen.queryByText("Run in background")).not.toBeInTheDocument()
    expect(screen.queryByText("Keep waiting")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument()
  })

  for (const [name, status] of [
    ["grading still pending", moocGrading({ grading_progress: "Pending" })],
    ["grading not ready", moocGrading({ grading_progress: "NotReady" })],
    ["no grading yet", { status: "no-grading-yet" }],
  ] as const) {
    test(`${name}: offers Keep waiting first, and Close`, async () => {
      render(ExerciseSubmission, { props: { panel: moocPanel } })
      showMoocGrading(status)

      expect(await screen.findByText(/VS Code stopped waiting/)).toBeInTheDocument()
      const keepWaiting = screen.getByRole("button", { name: "Keep waiting" })
      expect(keepWaiting).not.toHaveAttribute("secondary")
      expect(screen.getByRole("button", { name: "Close" })).toHaveAttribute("secondary")
      expect(screen.queryByText("Run in background")).not.toBeInTheDocument()
    })
  }

  test("Keep waiting asks the host to wait for the grading again", async () => {
    render(ExerciseSubmission, { props: { panel: moocPanel } })
    showMoocGrading(moocGrading({ grading_progress: "Pending" }))
    postedMessages.mockClear()

    ;(await screen.findByRole("button", { name: "Keep waiting" })).click()

    expect(postedMessages).toHaveBeenCalledWith({
      type: "keepWaitingForGrading",
      requestId: expect.any(Number),
      sourcePanel: { id: moocPanel.id, type: "ExerciseSubmission" },
    })
    expect(await screen.findByRole("button", { name: "Keep waiting" })).toHaveAttribute("disabled")

    showView(moocPanel.id, inProgressView("grading", { steps: ["Grading in progress"] }))
    expect(await screen.findByRole("button", { name: "Run in background" })).toBeInTheDocument()
  })

  test("a refused Keep waiting says why", async () => {
    render(ExerciseSubmission, { props: { panel: moocPanel } })
    showView(moocPanel.id, gradingUnavailableView({ message: "offline" }))
    ;(await screen.findByRole("button", { name: "Keep waiting" })).click()

    replyToRequest("keepWaitingForGrading", {
      ok: false,
      error: { message: "Already waiting for this submission's grading." },
    })

    expect(
      await screen.findByText("Already waiting for this submission's grading."),
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Keep waiting" })).not.toHaveAttribute("disabled")
  })
})

// VS Code reloads the document of a panel that was hidden; the host sends the panel and its
// latest view again, and the webview state keeps what only the webview knew.
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
    await fireEvent.click(await screen.findByRole("button", { name: "Need help?" }))
    ;(await screen.findByRole("button", { name: /^Submit to .* paste$/ })).click()
    replyToRequest("pasteExercise", { ok: true, value: "https://tmc.mooc.fi/paste/abc" })
    await screen.findByRole("link", { name: "https://tmc.mooc.fi/paste/abc" })

    reloadDocument()
    showPanel()

    expect(
      await screen.findByRole("link", { name: "https://tmc.mooc.fi/paste/abc" }),
    ).toBeInTheDocument()
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
