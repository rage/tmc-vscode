import { fireEvent, render, screen } from "@testing-library/svelte"

import type { SubmissionFinished } from "../shared/langsSchema"
import type { ExerciseSubmissionPanel, FeedbackQuestion } from "../shared/shared"
import { BaseError, toWebviewError } from "../shared/shared"
import {
  moocLocalCourse,
  moocLocalExercise,
  tmcLocalCourse,
  tmcLocalExercise,
} from "../test/fixtures"
import { dispatchToWebview, postedMessages } from "../test/setup"
import { withinShadowRoot } from "../test/shadow"
import ExerciseSubmission from "./ExerciseSubmission.svelte"

const panel: ExerciseSubmissionPanel = {
  id: 12,
  type: "ExerciseSubmission",
  course: tmcLocalCourse(),
  exercise: tmcLocalExercise({ name: "part01-01_hello", availablePoints: 2 }),
}

const moocPanel: ExerciseSubmissionPanel = {
  id: 13,
  type: "ExerciseSubmission",
  course: moocLocalCourse(),
  exercise: moocLocalExercise(),
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

// Posts the error that ends a failed submission on either backend. toWebviewError
// flattens it first: the schema needs a plain {message, details?}, not a live Error.
function postSubmissionError(panelId: number, error: Error): void {
  dispatchToWebview({
    type: "submissionStatusError",
    target: { type: "ExerciseSubmission", id: panelId },
    error: toWebviewError(error),
  })
}

function postStatusUpdate(panelId: number, fraction: number, message: string): void {
  dispatchToWebview({
    type: "submissionStatusUpdate",
    target: { type: "ExerciseSubmission", id: panelId },
    fraction,
    message,
  })
}

function postTmcResult(result: SubmissionFinished, questions: FeedbackQuestion[] = []): void {
  dispatchToWebview({
    type: "submissionResult",
    target: { type: "ExerciseSubmission", id: panel.id },
    result,
    questions,
  })
}

function postMoocResult(result: unknown): void {
  dispatchToWebview({
    type: "moocSubmissionResult",
    target: { type: "ExerciseSubmission", id: moocPanel.id },
    result,
  })
}

function moocGrading(overrides: Record<string, unknown>): unknown {
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

function progressLines(): string[] {
  return screen
    .getAllByRole("listitem")
    .map((item) => (item.textContent ?? "").replaceAll(/\s+/g, " ").trim())
}

async function clickToolbarButton(label: string): Promise<void> {
  const host = await screen.findByTitle(label)
  await fireEvent.click((await withinShadowRoot(host)).getByRole("button"))
}

suite("ExerciseSubmission panel", () => {
  test("names the exercise and shows the processing state until a result arrives", () => {
    render(ExerciseSubmission, { props: { panel } })
    expect(screen.getByRole("heading", { level: 1, name: "part01-01_hello" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Processing submission…" })).toBeInTheDocument()
  })

  test("appends server progress messages as they arrive", async () => {
    render(ExerciseSubmission, { props: { panel } })
    postStatusUpdate(panel.id, 0.4, "Compiling on the server")

    expect(await screen.findByText("Compiling on the server")).toBeInTheDocument()
  })

  test("renders the reported fraction on the progress bar's own scale", async () => {
    render(ExerciseSubmission, { props: { panel } })
    postStatusUpdate(panel.id, 0.4, "Compiling on the server")

    await screen.findByText("Compiling on the server")
    const host = document.querySelector("vscode-progress-bar")!
    const bar = (await withinShadowRoot(host)).getByRole("progressbar", {
      name: "Running tests on the server",
    })
    expect(bar).toHaveAttribute("aria-valuenow", "40")
    expect(bar).toHaveAttribute("aria-valuemax", "100")
    expect(bar).toHaveAttribute("aria-valuemin", "0")
  })

  test("a repeated status refreshes the live line instead of appending a duplicate", async () => {
    render(ExerciseSubmission, { props: { panel } })
    postStatusUpdate(panel.id, 10, "Grading in progress")
    postStatusUpdate(panel.id, 20, "Grading in progress")
    postStatusUpdate(panel.id, 30, "Grading in progress")

    await screen.findByText("Grading in progress")
    expect(progressLines()).toEqual(["Grading in progress"])
  })

  test("marks completed steps done and drops the oldest once the list is full", async () => {
    render(ExerciseSubmission, { props: { panel } })
    for (let step = 0; step < 30; step++) {
      postStatusUpdate(panel.id, step, `Step ${step}`)
    }

    expect(await screen.findByText("Step 29")).toBeInTheDocument()
    const lines = progressLines()
    expect(lines).toHaveLength(20)
    expect(lines[0]).toBe("Done: Step 10")
    expect(lines.at(-1)).toBe("Step 29")
  })

  test("announces each new step once through the shared live region", async () => {
    vi.useFakeTimers()
    try {
      render(ExerciseSubmission, { props: { panel } })
      postStatusUpdate(panel.id, 0.1, "Compiling on the server")
      await vi.runAllTimersAsync()

      expect(screen.getByTestId("announcer")).toHaveTextContent("Compiling on the server")
    } finally {
      vi.useRealTimers()
    }
  })

  test("announces whether the host managed to copy", async () => {
    vi.useFakeTimers()
    try {
      render(ExerciseSubmission, { props: { panel } })
      dispatchToWebview({
        type: "clipboardCopied",
        target: { type: "ExerciseSubmission", id: panel.id },
        ok: false,
      })
      await vi.runAllTimersAsync()

      expect(screen.getByTestId("announcer")).toHaveTextContent("Could not copy to the clipboard")
    } finally {
      vi.useRealTimers()
    }
  })

  test("replaces the progress view with the failure when the submission errors", async () => {
    render(ExerciseSubmission, { props: { panel } })
    postSubmissionError(panel.id, new BaseError("Failed to submit: connection reset", "ECONNRESET"))

    expect(await screen.findByRole("heading", { name: "Submission failed" })).toBeInTheDocument()
    expect(screen.getByRole("alert")).toHaveTextContent("Failed to submit: connection reset")
    expect(screen.getByRole("alert")).toHaveTextContent("ECONNRESET")
    expect(
      screen.queryByRole("heading", { name: "Processing submission…" }),
    ).not.toBeInTheDocument()
    expect(screen.queryByText("Run in background")).not.toBeInTheDocument()
  })

  test("closing the panel posts closeSidePanel", async () => {
    render(ExerciseSubmission, { props: { panel } })
    postedMessages.mockClear()
    await clickToolbarButton("Close")
    expect(postedMessages).toHaveBeenCalledWith({ type: "closeSidePanel" })
  })
})

suite("ExerciseSubmission panel (tmc results)", () => {
  test("shows the points against the exercise's available points", async () => {
    render(ExerciseSubmission, { props: { panel } })
    postTmcResult(submissionFinished({ points: ["1.1"] }))

    expect(
      await screen.findByRole("heading", { name: "All tests passed on the server" }),
    ).toBeInTheDocument()
    expect(screen.getByRole("meter", { name: "Points" })).toHaveAttribute(
      "aria-valuetext",
      "1 / 2 points",
    )
  })

  test("keeps the link to the submission once the result is in", async () => {
    render(ExerciseSubmission, { props: { panel } })
    postTmcResult(submissionFinished())

    const show = await screen.findByRole("button", { name: "Show submission in browser" })
    postedMessages.mockClear()
    show.click()
    expect(postedMessages).toHaveBeenCalledWith({
      type: "openLinkInBrowser",
      url: "https://tmc.mooc.fi/submissions/1",
    })
  })

  test("shows the server's own explanation of a processing error", async () => {
    render(ExerciseSubmission, { props: { panel } })
    postTmcResult(
      submissionFinished({
        status: "error",
        all_tests_passed: null,
        error: "Sandbox ran out of memory",
      }),
    )

    expect(
      await screen.findByRole("heading", { name: "Something went wrong…" }),
    ).toBeInTheDocument()
    expect(screen.getByRole("group", { name: "Server error" })).toHaveTextContent(
      "Sandbox ran out of memory",
    )
  })

  test("valgrind output is available behind a disclosure", async () => {
    render(ExerciseSubmission, { props: { panel } })
    postTmcResult(submissionFinished({ valgrind: "==1== definitely lost: 8 bytes" }))

    await fireEvent.click(await screen.findByRole("button", { name: "Valgrind output" }))
    expect(screen.getByRole("group", { name: "Valgrind output" })).toHaveTextContent(
      "definitely lost: 8 bytes",
    )
  })
})

suite("ExerciseSubmission panel (tmc feedback)", () => {
  const questions: FeedbackQuestion[] = [
    { id: 1, kind: "intrange", lower: 1, upper: 5, question: "How difficult was this?" },
    { id: 2, kind: "text", question: "Free feedback" },
  ]

  async function renderWithFeedback(): Promise<void> {
    render(ExerciseSubmission, { props: { panel } })
    postTmcResult(submissionFinished({ feedback_answer_url: FEEDBACK_URL }), questions)
    await screen.findByRole("heading", { name: "Give feedback" })
  }

  function postFeedbackSent(ok: boolean, error?: string): void {
    dispatchToWebview({
      type: "feedbackSent",
      target: { type: "ExerciseSubmission", id: panel.id },
      ok,
      error,
    })
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
      sourcePanel: { id: panel.id, type: "ExerciseSubmission" },
      feedbackAnswerUrl: FEEDBACK_URL,
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

  test("thanks the student once the host has sent it", async () => {
    await renderWithFeedback()
    postFeedbackSent(true)

    expect(await screen.findByText("Thank you for your feedback.")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Send feedback" })).not.toBeInTheDocument()
  })

  test("a failed send keeps the form and says why", async () => {
    await renderWithFeedback()
    postFeedbackSent(false, "connection reset")

    expect(await screen.findByRole("alert")).toHaveTextContent("connection reset")
    expect(await screen.findByRole("button", { name: "Send feedback" })).toBeInTheDocument()
  })

  test("no questions, no form", async () => {
    render(ExerciseSubmission, { props: { panel } })
    postTmcResult(submissionFinished({ feedback_answer_url: FEEDBACK_URL }))

    await screen.findByRole("heading", { name: "All tests passed on the server" })
    expect(screen.queryByRole("heading", { name: "Give feedback" })).not.toBeInTheDocument()
  })
})

suite("ExerciseSubmission panel (mooc reduced results)", () => {
  test("waits for grading on an indeterminate bar, since grading has no fraction", async () => {
    render(ExerciseSubmission, { props: { panel: moocPanel } })
    postStatusUpdate(moocPanel.id, 1, "Grading in progress")

    await screen.findByText("Grading in progress")
    const host = document.querySelector("vscode-progress-bar")!
    expect(host.indeterminate).toBe(true)
    expect(await screen.findByRole("button", { name: "Run in background" })).toBeInTheDocument()
  })

  test("renders the graded status, score out of the maximum and feedback text", async () => {
    render(ExerciseSubmission, { props: { panel: moocPanel } })
    postMoocResult(moocGrading({ score_given: 2.666666, feedback_text: "Great work" }))

    expect(await screen.findByRole("heading", { name: "Exercise graded" })).toBeInTheDocument()
    expect(screen.getByRole("meter", { name: "Score" })).toHaveAttribute(
      "aria-valuetext",
      "2.67 / 3 points",
    )
    expect(screen.getByText("Great work")).toBeInTheDocument()
    // the reduced mooc UI shows no per-test results table
    expect(screen.queryByText(/tests? (passed|failed)/i)).not.toBeInTheDocument()
  })

  test("renders the failed grading state", async () => {
    render(ExerciseSubmission, { props: { panel: moocPanel } })
    postMoocResult(moocGrading({ grading_progress: "Failed", score_given: 0 }))
    expect(await screen.findByRole("heading", { name: "Grading failed" })).toBeInTheDocument()
  })

  for (const [name, result, explanation] of [
    [
      "awaiting manual grading",
      moocGrading({ grading_progress: "PendingManual", score_given: 0.5 }),
      /A teacher will grade this submission/,
    ],
    [
      "grading still pending",
      moocGrading({ grading_progress: "Pending" }),
      /Grading did not finish while VS Code was waiting/,
    ],
    [
      "grading not ready",
      moocGrading({ grading_progress: "NotReady" }),
      /Grading did not finish while VS Code was waiting/,
    ],
    [
      "no grading yet",
      { status: "no-grading-yet" },
      /Grading did not finish while VS Code was waiting/,
    ],
  ] as const) {
    test(`${name}: the wait is over, so it explains and offers Close, not Run in background`, async () => {
      render(ExerciseSubmission, { props: { panel: moocPanel } })
      postMoocResult(result)

      expect(await screen.findByText(explanation)).toBeInTheDocument()
      expect(screen.queryByText("Run in background")).not.toBeInTheDocument()
      const close = await screen.findByRole("button", { name: "Close" })
      postedMessages.mockClear()
      close.click()
      expect(postedMessages).toHaveBeenCalledWith({ type: "closeSidePanel" })
    })
  }

  test("a finished grading offers Close without a waiting explanation", async () => {
    render(ExerciseSubmission, { props: { panel: moocPanel } })
    postMoocResult(moocGrading({ score_given: 1 }))

    await screen.findByRole("heading", { name: "Exercise graded" })
    expect(screen.queryByText("Run in background")).not.toBeInTheDocument()
    expect(screen.queryByText(/did not finish/)).not.toBeInTheDocument()
    expect(await screen.findByRole("button", { name: "Close" })).toBeInTheDocument()
  })

  test('shows the failure and hides "Run in background" when the submission errors', async () => {
    render(ExerciseSubmission, { props: { panel: moocPanel } })
    postSubmissionError(moocPanel.id, new Error("Grading could not be requested"))

    expect(await screen.findByRole("heading", { name: "Submission failed" })).toBeInTheDocument()
    expect(screen.getByRole("alert")).toHaveTextContent("Grading could not be requested")
    expect(screen.queryByText("Run in background")).not.toBeInTheDocument()
  })
})
