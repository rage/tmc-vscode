import { render, screen } from "@testing-library/svelte"
import type { Uri } from "vscode"

import type { ExerciseTestsPanel } from "../shared/shared"
import { getButton } from "../test/dom"
import { testResultData, tmcLocalCourse, tmcLocalExercise } from "../test/fixtures"
import { postedMessages } from "../test/setup"
import ExerciseTests from "./ExerciseTests.svelte"

const exerciseUri = { fsPath: "/ex", scheme: "file" } as unknown as Uri
const panel: ExerciseTestsPanel = {
  id: 11,
  type: "ExerciseTests",
  course: tmcLocalCourse(),
  exercise: tmcLocalExercise({ name: "part01-01_hello" }),
  exerciseUri,
  testRunId: 1,
}

suite("ExerciseTests panel", () => {
  test("requests its data on mount and shows the running-tests state", () => {
    render(ExerciseTests, { props: { panel } })
    expect(postedMessages).toHaveBeenCalledWith({
      type: "requestExerciseTestsData",
      sourcePanel: panel,
    })
    expect(screen.getByRole("heading", { name: "Running tests" })).toBeInTheDocument()
  })

  test("cancelling posts cancelTests and closes the panel", () => {
    render(ExerciseTests, { props: { panel } })
    postedMessages.mockClear()
    getButton("Cancel").click()

    expect(postedMessages).toHaveBeenCalledWith({ type: "cancelTests", testRunId: 1 })
    expect(postedMessages).toHaveBeenCalledWith({ type: "closeSidePanel" })
  })

  test("shows the passed state and submits the solution", async () => {
    render(ExerciseTests, { props: { panel } })
    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "testResults",
          target: { type: "ExerciseTests", id: panel.id },
          testResults: testResultData(),
        },
      }),
    )

    expect(await screen.findByRole("heading", { name: "Tests passed" })).toBeInTheDocument()

    const submit = getButton("Submit to server")
    postedMessages.mockClear()
    submit.click()

    expect(postedMessages).toHaveBeenCalledWith({
      type: "submitExercise",
      course: panel.course,
      exercise: panel.exercise,
      exerciseUri,
    })
  })
})
