import { fireEvent, render, screen } from "@testing-library/svelte"
import { tick } from "svelte"
import type { Uri } from "vscode"

import type { ExerciseTestsPanel } from "../shared/shared"
import {
  moocLocalCourse,
  moocLocalExercise,
  testResult,
  testResultData,
  tmcLocalCourse,
  tmcLocalExercise,
} from "../test/fixtures"
import { dispatchToWebview, postedMessages, replyToRequest } from "../test/setup"
import { withinShadowRoot } from "../test/shadow"
import ExerciseTests from "./ExerciseTests.svelte"

const exerciseUri = { fsPath: "/ex", scheme: "file" } as unknown as Uri
const panel: ExerciseTestsPanel = {
  id: 11,
  type: "ExerciseTests",
  course: tmcLocalCourse(),
  exercise: tmcLocalExercise({ name: "part01-01_hello", availablePoints: 3 }),
  exerciseUri,
  testRunId: 1,
}

function postTestError(error: { message: string; details?: string }): void {
  dispatchToWebview({
    type: "testError",
    target: { type: "ExerciseTests", id: panel.id },
    error,
  })
}

function postTestResults(testResults: unknown): void {
  dispatchToWebview({
    type: "testResults",
    target: { type: "ExerciseTests", id: panel.id },
    testResults,
  })
}

async function clickToolbarButton(label: string): Promise<void> {
  const host = await screen.findByTitle(label)
  await fireEvent.click((await withinShadowRoot(host)).getByRole("button"))
}

suite("ExerciseTests panel", () => {
  test("shows the running-tests state until a result is pushed to it", () => {
    render(ExerciseTests, { props: { panel } })
    expect(screen.getByRole("heading", { name: "Running tests" })).toBeInTheDocument()
  })

  test("cancelling posts cancelTests and closes the panel", async () => {
    render(ExerciseTests, { props: { panel } })
    postedMessages.mockClear()
    ;(await screen.findByRole("button", { name: "Cancel" })).click()

    expect(postedMessages).toHaveBeenCalledWith({ type: "cancelTests", testRunId: 1 })
    expect(postedMessages).toHaveBeenCalledWith({ type: "closeSidePanel" })
  })

  test("shows the passed state and submits the solution", async () => {
    render(ExerciseTests, { props: { panel } })
    postTestResults(testResultData())

    expect(await screen.findByRole("heading", { name: "Tests passed" })).toBeInTheDocument()

    const submit = await screen.findByRole("button", { name: "Submit to server" })
    postedMessages.mockClear()
    submit.click()

    expect(postedMessages).toHaveBeenCalledWith({
      type: "submitExercise",
      requestId: expect.any(Number),
      sourcePanel: { id: panel.id, type: "ExerciseTests" },
    })
  })

  test("a second click while a submit is pending posts nothing", async () => {
    render(ExerciseTests, { props: { panel } })
    postTestResults(testResultData())
    expect(await screen.findByRole("heading", { name: "Tests passed" })).toBeInTheDocument()

    const submit = await screen.findByRole("button", { name: "Submit to server" })
    submit.click()
    postedMessages.mockClear()
    submit.click()

    expect(postedMessages).not.toHaveBeenCalled()
  })

  test("a reply re-enables submitting, since no submission panel replaced this one", async () => {
    render(ExerciseTests, { props: { panel } })
    postTestResults(testResultData())
    expect(await screen.findByRole("heading", { name: "Tests passed" })).toBeInTheDocument()

    const submit = await screen.findByRole("button", { name: "Submit to server" })
    submit.click()
    replyToRequest("submitExercise", { ok: true })
    await tick()

    postedMessages.mockClear()
    ;(await screen.findByRole("button", { name: "Submit to server" })).click()

    expect(postedMessages).toHaveBeenCalledWith({
      type: "submitExercise",
      requestId: expect.any(Number),
      sourcePanel: { id: panel.id, type: "ExerciseTests" },
    })
  })

  test("offers paste help only when a test failed", async () => {
    render(ExerciseTests, { props: { panel } })
    postTestResults(testResultData())
    expect(await screen.findByRole("heading", { name: "Tests passed" })).toBeInTheDocument()
    expect(screen.queryByText("Need help?")).not.toBeInTheDocument()

    postTestResults(
      testResultData({
        testResult: {
          logs: {},
          status: "TESTS_FAILED",
          testResults: [testResult({ successful: false, message: "boom" })],
        },
      }),
    )
    expect(await screen.findByRole("button", { name: "Need help?" })).toBeInTheDocument()
  })

  test("a failed test run shows the failure, the choice and a working Close button", async () => {
    render(ExerciseTests, { props: { panel } })
    postTestError({ message: "Failed to run tests", details: "no compiler on PATH" })

    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("Failed to run tests")
    expect(alert).toHaveTextContent("no compiler on PATH")
    expect(screen.getByText(/You can still submit your answer to the server/)).toBeInTheDocument()

    postedMessages.mockClear()
    await clickToolbarButton("Close")
    expect(postedMessages).toHaveBeenCalledWith({ type: "closeSidePanel" })
  })

  test("testError re-enables submitting", async () => {
    render(ExerciseTests, { props: { panel } })
    postTestResults(testResultData())
    expect(await screen.findByRole("heading", { name: "Tests passed" })).toBeInTheDocument()
    ;(await screen.findByRole("button", { name: "Submit to server" })).click()

    postTestError({ message: "boom" })
    await tick()

    postedMessages.mockClear()
    ;(await screen.findByRole("button", { name: "Submit to server" })).click()
    expect(postedMessages).toHaveBeenCalledWith({
      type: "submitExercise",
      requestId: expect.any(Number),
      sourcePanel: { id: panel.id, type: "ExerciseTests" },
    })
  })

  test("a compile failure shows the compiler output, open, and no points meter", async () => {
    render(ExerciseTests, { props: { panel } })
    postTestResults(
      testResultData({
        testResult: {
          logs: { stdout: "", stderr: "Main.java:3: error: ';' expected" },
          status: "COMPILE_FAILED",
          testResults: [],
        },
      }),
    )

    expect(await screen.findByRole("heading", { name: "Compilation failed" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Output" })).toHaveAttribute("aria-expanded", "true")
    expect(screen.getByRole("group", { name: "Standard error" })).toHaveTextContent(
      "Main.java:3: error: ';' expected",
    )
    expect(screen.queryByRole("group", { name: "Standard output" })).not.toBeInTheDocument()
    expect(screen.queryByRole("meter")).not.toBeInTheDocument()
  })

  test("program output of a run with results is available but collapsed", async () => {
    render(ExerciseTests, { props: { panel } })
    postTestResults(
      testResultData({
        testResult: {
          logs: { stdout: "Hello from print()" },
          status: "PASSED",
          testResults: [testResult()],
        },
      }),
    )

    const toggle = await screen.findByRole("button", { name: "Output" })
    expect(toggle).toHaveAttribute("aria-expanded", "false")
    expect(screen.getByRole("group", { name: "Standard output", hidden: true })).toHaveTextContent(
      "Hello from print()",
    )
  })

  test("copying output posts copyToClipboard with its text", async () => {
    render(ExerciseTests, { props: { panel } })
    postTestResults(
      testResultData({
        testResult: { logs: { stderr: "boom" }, status: "COMPILE_FAILED", testResults: [] },
      }),
    )
    await screen.findByRole("heading", { name: "Compilation failed" })

    postedMessages.mockClear()
    await clickToolbarButton("Copy Standard error")
    expect(postedMessages).toHaveBeenCalledWith({
      type: "copyToClipboard",
      requestId: expect.any(Number),
      sourcePanel: { id: panel.id, type: "ExerciseTests" },
      text: "boom",
    })
  })

  test("announces whether the host managed to copy", async () => {
    vi.useFakeTimers()
    try {
      render(ExerciseTests, { props: { panel } })
      postTestResults(
        testResultData({
          testResult: { logs: { stderr: "boom" }, status: "COMPILE_FAILED", testResults: [] },
        }),
      )
      await vi.runAllTimersAsync()

      await clickToolbarButton("Copy Standard error")
      replyToRequest("copyToClipboard", { ok: true })
      await vi.runAllTimersAsync()
      expect(screen.getByTestId("announcer")).toHaveTextContent("Copied to the clipboard")

      await clickToolbarButton("Copy Standard error")
      replyToRequest("copyToClipboard", { ok: false, error: { message: "no clipboard" } })
      await vi.runAllTimersAsync()
      expect(screen.getByTestId("announcer")).toHaveTextContent("Could not copy to the clipboard")
    } finally {
      vi.useRealTimers()
    }
  })

  test("python-style results: 1 of 3 tests passing awards only that test's point", async () => {
    render(ExerciseTests, { props: { panel } })
    postTestResults(
      testResultData({
        testResult: {
          logs: {},
          status: "TESTS_FAILED",
          testResults: [
            testResult({ name: "a", successful: true, points: ["1.1"] }),
            testResult({ name: "b", successful: false, points: [] }),
            testResult({ name: "c", successful: false, points: [] }),
          ],
        },
      }),
    )

    expect(await screen.findByText("1 of 3 tests passed")).toBeInTheDocument()
    expect(screen.getByRole("meter", { name: "Points" })).toHaveAttribute(
      "aria-valuetext",
      "1 / 3 points",
    )
  })

  test("java-style results: a shared point with a failing test is not awarded", async () => {
    render(ExerciseTests, { props: { panel } })
    postTestResults(
      testResultData({
        testResult: {
          logs: {},
          status: "TESTS_FAILED",
          testResults: [
            testResult({ name: "a", successful: true, points: ["1.1"] }),
            testResult({ name: "b", successful: true, points: ["1.1"] }),
            testResult({ name: "c", successful: false, points: ["1.1"] }),
          ],
        },
      }),
    )

    expect(await screen.findByText("2 of 3 tests passed")).toBeInTheDocument()
    expect(screen.getByRole("meter", { name: "Points" })).toHaveAttribute(
      "aria-valuetext",
      "0 / 3 points",
    )
  })

  test("a mooc run counts tests but shows no points, whose unit is the score maximum", async () => {
    render(ExerciseTests, {
      props: {
        panel: { ...panel, course: moocLocalCourse(), exercise: moocLocalExercise() },
      },
    })
    postTestResults(testResultData())

    expect(await screen.findByText("1 of 1 tests passed")).toBeInTheDocument()
    expect(screen.queryByRole("meter")).not.toBeInTheDocument()
  })

  test("a code quality check that could not run is a warning beside the results", async () => {
    render(ExerciseTests, { props: { panel } })
    postTestResults(testResultData({ styleValidationError: "Checkstyle crashed" }))

    expect(await screen.findByRole("heading", { name: "Tests passed" })).toBeInTheDocument()
    const warning = screen
      .getByText("Code quality checks could not be run")
      .closest("[role=status]")
    expect(warning).toHaveTextContent("Checkstyle crashed")
    expect(screen.getByText("1 of 1 tests passed")).toBeInTheDocument()
  })
})
