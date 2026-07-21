import { render, screen } from "@testing-library/svelte"

import type { ExerciseSubmissionPanel } from "../shared/shared"
import { getButton } from "../test/dom"
import {
  moocLocalCourse,
  moocLocalExercise,
  tmcLocalCourse,
  tmcLocalExercise,
} from "../test/fixtures"
import { postedMessages } from "../test/setup"
import ExerciseSubmission from "./ExerciseSubmission.svelte"

const panel: ExerciseSubmissionPanel = {
  id: 12,
  type: "ExerciseSubmission",
  course: tmcLocalCourse(),
  exercise: tmcLocalExercise(),
}

const moocPanel: ExerciseSubmissionPanel = {
  id: 13,
  type: "ExerciseSubmission",
  course: moocLocalCourse(),
  exercise: moocLocalExercise(),
}

// Posts a mooc grading result to the panel.
function postMoocResult(result: unknown): void {
  window.dispatchEvent(
    new MessageEvent("message", {
      data: {
        type: "moocSubmissionResult",
        target: { type: "ExerciseSubmission", id: moocPanel.id },
        result,
      },
    }),
  )
}

suite("ExerciseSubmission panel", () => {
  test("requests its data on mount and shows the processing state", () => {
    render(ExerciseSubmission, { props: { panel } })
    expect(postedMessages).toHaveBeenCalledWith({
      type: "requestExerciseSubmissionData",
      sourcePanel: panel,
    })
    expect(screen.getByRole("heading", { name: "Processing submission…" })).toBeInTheDocument()
  })

  test("appends server progress messages as they arrive", async () => {
    render(ExerciseSubmission, { props: { panel } })
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "submissionStatusUpdate",
          target: { type: "ExerciseSubmission", id: panel.id },
          progressPercent: 40,
          message: "Compiling on the server",
        },
      }),
    )
    expect(await screen.findByText("Compiling on the server")).toBeInTheDocument()
  })

  test("closing the panel posts closeSidePanel", () => {
    render(ExerciseSubmission, { props: { panel } })
    postedMessages.mockClear()
    getButton("Close").click()
    expect(postedMessages).toHaveBeenCalledWith({ type: "closeSidePanel" })
  })
})

suite("ExerciseSubmission panel (mooc reduced results)", () => {
  test("renders the graded status, score and feedback text, no per-test list", async () => {
    render(ExerciseSubmission, { props: { panel: moocPanel } })
    postMoocResult({
      Grading: {
        grading_progress: "FullyGraded",
        score_given: 3,
        grading_started_at: "2026-07-21T00:00:00Z",
        grading_completed_at: "2026-07-21T00:00:01Z",
        feedback_json: null,
        feedback_text: "Great work",
      },
    })
    expect(await screen.findByRole("heading", { name: "Exercise graded" })).toBeInTheDocument()
    expect(screen.getByText("Score: 3")).toBeInTheDocument()
    expect(screen.getByText("Great work")).toBeInTheDocument()
    // the reduced mooc UI shows no per-test results table
    expect(screen.queryByText(/tests? (passed|failed)/i)).not.toBeInTheDocument()
  })

  test("renders the failed grading state", async () => {
    render(ExerciseSubmission, { props: { panel: moocPanel } })
    postMoocResult({
      Grading: {
        grading_progress: "Failed",
        score_given: 0,
        grading_started_at: null,
        grading_completed_at: null,
        feedback_json: null,
        feedback_text: "Some tests failed",
      },
    })
    expect(await screen.findByRole("heading", { name: "Grading failed" })).toBeInTheDocument()
  })

  test("renders the pending-manual (awaiting human) state", async () => {
    render(ExerciseSubmission, { props: { panel: moocPanel } })
    postMoocResult({
      Grading: {
        grading_progress: "PendingManual",
        score_given: 0.5,
        grading_started_at: null,
        grading_completed_at: null,
        feedback_json: null,
        feedback_text: null,
      },
    })
    expect(
      await screen.findByRole("heading", { name: "Awaiting manual grading" }),
    ).toBeInTheDocument()
    expect(screen.getByText("Score: 0.5")).toBeInTheDocument()
  })

  test('keeps "Run in background" visible through non-terminal grading states', async () => {
    // Must not disappear just because *some* moocResult arrived — only once grading is done.
    render(ExerciseSubmission, { props: { panel: moocPanel } })
    expect(getButton("Run in background")).toBeInTheDocument()

    postMoocResult({
      Grading: {
        grading_progress: "PendingManual",
        score_given: null,
        grading_started_at: null,
        grading_completed_at: null,
        feedback_json: null,
        feedback_text: null,
      },
    })
    await screen.findByRole("heading", { name: "Awaiting manual grading" })
    expect(getButton("Run in background")).toBeInTheDocument()
  })

  test('hides "Run in background" once grading is fully graded', async () => {
    render(ExerciseSubmission, { props: { panel: moocPanel } })
    postMoocResult({
      Grading: {
        grading_progress: "FullyGraded",
        score_given: 1,
        grading_started_at: null,
        grading_completed_at: null,
        feedback_json: null,
        feedback_text: null,
      },
    })
    await screen.findByRole("heading", { name: "Exercise graded" })
    expect(screen.queryByText("Run in background")).not.toBeInTheDocument()
  })

  test('hides "Run in background" once grading has failed', async () => {
    render(ExerciseSubmission, { props: { panel: moocPanel } })
    postMoocResult({
      Grading: {
        grading_progress: "Failed",
        score_given: 0,
        grading_started_at: null,
        grading_completed_at: null,
        feedback_json: null,
        feedback_text: null,
      },
    })
    await screen.findByRole("heading", { name: "Grading failed" })
    expect(screen.queryByText("Run in background")).not.toBeInTheDocument()
  })
})
