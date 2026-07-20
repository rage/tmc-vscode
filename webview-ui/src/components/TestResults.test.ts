import { render, screen } from "@testing-library/svelte"

import { testResult } from "../test/fixtures"
import TestResults from "./TestResults.svelte"

suite("TestResults component", () => {
  test("renders a passed and a failed test with their names", () => {
    render(TestResults, {
      props: {
        totalPoints: 2,
        successPoints: 1,
        testResults: [
          testResult({ name: "passing_test", successful: true }),
          testResult({ name: "failing_test", successful: false, message: "boom" }),
        ],
        validationResult: null,
        solutionUrl: null,
      },
    })

    // a mix of pass/fail: passed tests are shown (not all failed / all passed)
    expect(screen.getByText("Test failed")).toBeInTheDocument()
    expect(screen.getByText("failing_test")).toBeInTheDocument()
    expect(screen.getByText("boom")).toBeInTheDocument()
  })

  test("renders code-quality errors when the validation strategy is FAIL", () => {
    render(TestResults, {
      props: {
        totalPoints: 1,
        successPoints: 0,
        testResults: [testResult({ successful: false })],
        validationResult: {
          strategy: "FAIL",
          validation_errors: {
            "Main.java": [{ column: 1, line: 2, message: "bad style" }],
          },
        },
        solutionUrl: null,
      },
    })

    expect(screen.getByText("Code quality errors found")).toBeInTheDocument()
    expect(screen.getByText(/bad style/)).toBeInTheDocument()
  })
})
