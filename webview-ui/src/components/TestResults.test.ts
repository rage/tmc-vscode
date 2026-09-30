import { fireEvent, render, screen } from "@testing-library/svelte"

import { testResult } from "../test/fixtures"
import { withinShadowRoot } from "../test/shadow"
import TestResults from "./TestResults.svelte"

suite("TestResults component", () => {
  test("summarises the run and lists each test under a status heading", () => {
    render(TestResults, {
      props: {
        testResults: [
          testResult({ name: "passing_test", successful: true }),
          testResult({ name: "failing_test", successful: false, message: "boom" }),
        ],
        validationResult: null,
      },
    })

    expect(screen.getByText("1 of 2 tests passed")).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Failed failing_test" })).toBeInTheDocument()
    expect(screen.getByText("boom")).toBeInTheDocument()
    // a mix of pass and fail hides the passed ones behind the checkbox
    expect(
      screen.getByRole("heading", { name: "Passed passing_test", hidden: true }),
    ).not.toBeVisible()
  })

  test("shows a failed test's stack trace behind a disclosure", async () => {
    render(TestResults, {
      props: {
        testResults: [
          testResult({
            successful: false,
            message: "expected 1 but was 2",
            exception: ["AssertionError", "  at Main.test(Main.java:12)"],
          }),
        ],
        validationResult: null,
      },
    })

    const toggle = screen.getByRole("button", { name: "Stack trace" })
    expect(toggle).toHaveAttribute("aria-expanded", "false")
    await fireEvent.click(toggle)
    expect(screen.getByRole("group", { name: "Stack trace" })).toHaveTextContent(
      "at Main.test(Main.java:12)",
    )
  })

  test("shows a server test case's detailed message", () => {
    render(TestResults, {
      props: {
        testResults: [
          {
            name: "server_test",
            successful: false,
            message: "failed",
            detailed_message: "valgrind: 1 leak",
            exception: null,
          },
        ],
        validationResult: null,
      },
    })

    expect(screen.getByRole("group", { name: "Details" })).toHaveTextContent("valgrind: 1 leak")
  })

  test("copying a stack trace hands its text to the caller", async () => {
    const oncopy = vi.fn()
    render(TestResults, {
      props: {
        testResults: [testResult({ successful: false, exception: ["line one", "line two"] })],
        validationResult: null,
        oncopy,
      },
    })

    await fireEvent.click(screen.getByRole("button", { name: "Stack trace" }))
    const copy = screen.getByTitle("Copy Stack trace")
    await fireEvent.click((await withinShadowRoot(copy)).getByRole("button"))
    expect(oncopy).toHaveBeenCalledWith("line one\nline two")
  })

  test("renders code-quality errors when the validation strategy is FAIL", () => {
    render(TestResults, {
      props: {
        testResults: [testResult({ successful: false })],
        validationResult: {
          strategy: "FAIL",
          validation_errors: {
            "Main.java": [{ column: 1, line: 2, message: "bad style" }],
          },
        },
      },
    })

    expect(screen.getByRole("heading", { name: "Code quality errors found" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { name: "Error Main.java" })).toBeInTheDocument()
    expect(screen.getByText("Line 2, column 1: bad style")).toBeInTheDocument()
  })

  test("shows no summary for a run without test results", () => {
    render(TestResults, {
      props: { testResults: [], validationResult: null },
    })

    expect(screen.queryByText(/tests passed/)).not.toBeInTheDocument()
  })

  test("duplicate test names still render every result", () => {
    render(TestResults, {
      props: {
        testResults: [
          testResult({ name: "same", successful: false, message: "first" }),
          testResult({ name: "same", successful: false, message: "second" }),
        ],
        validationResult: null,
      },
    })

    expect(screen.getByText("first")).toBeInTheDocument()
    expect(screen.getByText("second")).toBeInTheDocument()
  })
})
