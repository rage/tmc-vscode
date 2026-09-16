import { render, screen } from "@testing-library/svelte"
import { tick } from "svelte"
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

// Posts the error that ends a failed test run, through the same JSON serialization the
// webview bridge applies -- a live `Error` would arrive without its `message`.
function postTestError(error: { message: string; details?: string }): void {
  const message = {
    type: "testError",
    target: { type: "ExerciseTests", id: panel.id },
    error,
  }
  window.dispatchEvent(
    new MessageEvent("message", { data: JSON.parse(JSON.stringify(message)) as unknown }),
  )
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

  test("a second click while a submit is pending posts nothing", async () => {
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
    submit.click()
    postedMessages.mockClear()
    submit.click()

    expect(postedMessages).not.toHaveBeenCalled()
  })

  test("submitFailed re-enables submitting, since no submission panel replaced this one", async () => {
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
    submit.click()
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { type: "submitFailed", target: { type: "ExerciseTests" } },
      }),
    )
    await tick()

    postedMessages.mockClear()
    getButton("Submit to server").click()

    expect(postedMessages).toHaveBeenCalledWith({
      type: "submitExercise",
      course: panel.course,
      exercise: panel.exercise,
      exerciseUri,
    })
  })

  test("a failed test run shows the failure, the choice and a working Close button", async () => {
    render(ExerciseTests, { props: { panel } })
    postTestError({ message: "Failed to run tests", details: "no compiler on PATH" })

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("Failed to run tests")
    expect(alert).toHaveTextContent("no compiler on PATH")
    expect(screen.getByText(/You can still submit your answer to the server/)).toBeInTheDocument()

    postedMessages.mockClear()
    getButton("Close").click()
    expect(postedMessages).toHaveBeenCalledWith({ type: "closeSidePanel" })
  })

  test("testError re-enables submitting", async () => {
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
    getButton("Submit to server").click()

    window.dispatchEvent(
      new MessageEvent("message", {
        data: {
          type: "testError",
          target: { type: "ExerciseTests", id: panel.id },
          error: new Error("boom"),
        },
      }),
    )
    await tick()

    postedMessages.mockClear()
    getButton("Submit to server").click()
    expect(postedMessages).toHaveBeenCalledWith(expect.objectContaining({ type: "submitExercise" }))
  })
})
