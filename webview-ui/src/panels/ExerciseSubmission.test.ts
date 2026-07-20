import { render, screen } from "@testing-library/svelte"

import type { ExerciseSubmissionPanel } from "../shared/shared"
import { tmcLocalCourse, tmcLocalExercise } from "../test/fixtures"
import { postedMessages } from "../test/setup"
import ExerciseSubmission from "./ExerciseSubmission.svelte"

const panel: ExerciseSubmissionPanel = {
  id: 12,
  type: "ExerciseSubmission",
  course: tmcLocalCourse(),
  exercise: tmcLocalExercise(),
}

suite("ExerciseSubmission panel", () => {
  test("requests its data on mount and shows the processing state", () => {
    render(ExerciseSubmission, { props: { panel } })
    expect(postedMessages).toHaveBeenCalledWith({
      type: "requestExerciseSubmissionData",
      sourcePanel: panel,
    })
    expect(screen.getByRole("heading", { name: "Processing submission..." })).toBeInTheDocument()
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
    screen.getByRole("button", { name: "×" }).click()
    expect(postedMessages).toHaveBeenCalledWith({ type: "closeSidePanel" })
  })
})
