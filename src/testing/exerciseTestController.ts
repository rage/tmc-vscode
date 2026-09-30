import type { Result } from "ts-results"
import { Ok } from "ts-results"
import * as vscode from "vscode"

import type { ExerciseTestOutcome } from "../actions/testExercise"
import { testExercise } from "../actions/testExercise"
import type { ReadyActionContext } from "../actions/types"
import type { WorkspaceExercise } from "../api/workspaceManager"
import { BottleneckError } from "../errors"
import type { RunResult, TestResult } from "../shared/langsSchema"
import { BaseError } from "../shared/shared"
import type { CheckstyleDiagnostics } from "./checkstyleDiagnostics"
import { openCourseExercises } from "./openExercises"
import { createSourceFileFinder } from "./sourceFiles"
import { failureMessage } from "./testMessages"

/** The `controllerId` that package.json's `testing/*` menus match on. */
export const TEST_CONTROLLER_ID = "tmc"

/**
 * Reports local test runs through the VS Code Testing API: one test item per exercise open
 * in the course workspace, with its tests as children once a run has named them.
 *
 * tmc-langs only runs whole exercises, so running any test runs its exercise.
 */
export class ExerciseTestController implements vscode.Disposable {
  private readonly _controller: vscode.TestController
  private readonly _profile: vscode.TestRunProfile
  private readonly _exercisesByItemId = new Map<string, WorkspaceExercise>()

  public constructor(
    private readonly _actionContext: ReadyActionContext,
    private readonly _diagnostics: CheckstyleDiagnostics,
  ) {
    this._controller = vscode.tests.createTestController(TEST_CONTROLLER_ID, "TestMyCode")
    this._profile = this._controller.createRunProfile(
      "Run Tests",
      vscode.TestRunProfileKind.Run,
      async (request, token) => {
        await this._run(request, token)
      },
      true,
    )
    this.syncExercises()
  }

  /** Makes the test items match the exercises open in the course workspace. */
  public syncExercises(): void {
    const exercises = openCourseExercises(this._actionContext.startup.workspaceManager)
    this._exercisesByItemId.clear()
    this._controller.items.replace(exercises.map((exercise) => this._itemFor(exercise)))
    this._diagnostics.retain(exercises.map((exercise) => exercise.uri))
  }

  /**
   * Runs an exercise's tests as a run of its test item, so the results land in the Test
   * Results view.
   *
   * @returns `Err(BottleneckError)` when the exercise was already being tested; every other
   * outcome, failures included, is reported in the run itself.
   */
  public async runExercise(exercise: WorkspaceExercise): Promise<Result<void, Error>> {
    const item = this._itemFor(exercise)
    if (!this._controller.items.get(item.id)) {
      this._controller.items.add(item)
    }
    const cancellation = new vscode.CancellationTokenSource()
    try {
      // An unset `preserveFocus` defaults to true, which keeps Test Results from opening.
      return await this._run(
        new vscode.TestRunRequest([item], undefined, this._profile, false, false),
        cancellation.token,
      )
    } finally {
      cancellation.dispose()
    }
  }

  /** The exercise folder of a test item, or of the exercise a test belongs to. */
  public exerciseUriOf(item: vscode.TestItem | undefined): vscode.Uri | undefined {
    let root = item
    while (root?.parent) {
      root = root.parent
    }
    return root && this._exercisesByItemId.get(root.id)?.uri
  }

  public dispose(): void {
    this._controller.dispose()
  }

  private _itemFor(exercise: WorkspaceExercise): vscode.TestItem {
    const id = exercise.uri.toString()
    this._exercisesByItemId.set(id, exercise)
    return (
      this._controller.items.get(id) ??
      this._controller.createTestItem(id, exercise.exerciseSlug, exercise.uri)
    )
  }

  private _requestedExercises(
    request: vscode.TestRunRequest,
  ): [vscode.TestItem, WorkspaceExercise][] {
    const included: vscode.TestItem[] = []
    if (request.include) {
      included.push(...request.include)
    } else {
      this._controller.items.forEach((item) => void included.push(item))
    }
    const excluded = new Set(request.exclude?.map((item) => item.id))
    const requested = new Map<string, [vscode.TestItem, WorkspaceExercise]>()
    for (const item of included) {
      let root = item
      while (root.parent) {
        root = root.parent
      }
      const exercise = this._exercisesByItemId.get(root.id)
      if (exercise && !excluded.has(root.id)) {
        requested.set(root.id, [root, exercise])
      }
    }
    return [...requested.values()]
  }

  private async _run(
    request: vscode.TestRunRequest,
    token: vscode.CancellationToken,
  ): Promise<Result<void, Error>> {
    const requested = this._requestedExercises(request)
    const [only] = requested
    const run = this._controller.createTestRun(
      request,
      requested.length === 1 ? only?.[1].exerciseSlug : undefined,
    )
    const cancellation = new vscode.CancellationTokenSource()
    const forwards = [token, run.token].map((source) =>
      source.onCancellationRequested(() => cancellation.cancel()),
    )
    let busy: Result<void, Error> = Ok.EMPTY
    try {
      for (const [item] of requested) {
        run.enqueued(item)
      }
      for (const [item, exercise] of requested) {
        if (cancellation.token.isCancellationRequested) {
          run.skipped(item)
          continue
        }
        run.started(item)
        const outcome = await this._testExercise(exercise, cancellation.token)
        if (cancellation.token.isCancellationRequested) {
          run.skipped(item)
        } else if (outcome.err) {
          if (outcome.val instanceof BottleneckError) {
            busy = outcome
          }
          this._reportError(run, item, outcome.val)
        } else {
          const isAllPassed = await this._reportOutcome(run, item, exercise, outcome.val)
          if (requested.length === 1) {
            this._offerSubmit(exercise, outcome.val, isAllPassed)
          }
        }
      }
    } finally {
      run.end()
      forwards.forEach((forward) => forward.dispose())
      cancellation.dispose()
    }
    return busy
  }

  private _testExercise(
    exercise: WorkspaceExercise,
    token: vscode.CancellationToken,
  ): Promise<Result<ExerciseTestOutcome, Error>> {
    return testExercise(this._actionContext, exercise, token)
  }

  private _reportError(run: vscode.TestRun, item: vscode.TestItem, error: Error): void {
    if (error instanceof BottleneckError) {
      run.appendOutput(toTerminalText(`${error.message}\n`), undefined, item)
      run.skipped(item)
      return
    }
    const details = error instanceof BaseError && error.details ? `\n\n${error.details}` : ""
    run.errored(
      item,
      new vscode.TestMessage(`The tests could not be run: ${error.message}${details}`),
    )
  }

  /** @returns Whether every test passed with nothing for the code quality checks to fault. */
  private async _reportOutcome(
    run: vscode.TestRun,
    item: vscode.TestItem,
    exercise: WorkspaceExercise,
    outcome: ExerciseTestOutcome,
  ): Promise<boolean> {
    if (outcome.kind === "examMode") {
      this._diagnostics.clear(exercise.uri)
      run.appendOutput(
        toTerminalText(
          "Tests are not run locally in exam mode. Submit the exercise to have it graded.\n",
        ),
        undefined,
        item,
      )
      run.skipped(item)
      return false
    }

    const { runResult, styleValidation } = outcome
    for (const [stream, text] of Object.entries(runResult.logs)) {
      if (text.trim() !== "") {
        run.appendOutput(toTerminalText(`${stream}:\n${text}\n`), undefined, item)
      }
    }
    await this._diagnostics.report(exercise.uri, styleValidation.ok ? styleValidation.val : null)
    if (styleValidation.err) {
      run.appendOutput(
        toTerminalText(`Code quality checks could not be run: ${styleValidation.val.message}\n`),
        undefined,
        item,
      )
    }

    const failure = runFailure(runResult)
    if (failure !== undefined) {
      run.errored(item, new vscode.TestMessage(failure))
      return false
    }

    const results = runResult.testResults
    await this._reportTests(run, item, exercise, results)
    const passedCount = results.filter((result) => result.successful).length
    item.description = `${passedCount}/${results.length} tests passed`

    const styleProblemCount =
      styleValidation.ok && styleValidation.val?.strategy === "FAIL"
        ? Object.values(styleValidation.val.validation_errors ?? {}).flat().length
        : 0
    const messages: vscode.TestMessage[] = []
    if (passedCount < results.length || runResult.status !== "PASSED") {
      messages.push(
        new vscode.TestMessage(
          `${results.length - passedCount} of ${results.length} tests failed.`,
        ),
      )
    }
    if (styleProblemCount > 0) {
      messages.push(
        new vscode.TestMessage(
          `Code quality checks found ${styleProblemCount} ${styleProblemCount === 1 ? "problem" : "problems"}. They are listed in the Problems panel.`,
        ),
      )
    }
    if (messages.length > 0) {
      run.failed(item, messages)
      return false
    }
    run.passed(item)
    return true
  }

  private async _reportTests(
    run: vscode.TestRun,
    item: vscode.TestItem,
    exercise: WorkspaceExercise,
    results: readonly TestResult[],
  ): Promise<void> {
    const children = new Map<string, [vscode.TestItem, TestResult]>()
    for (const result of results) {
      let id = `${item.id}/${result.name}`
      for (let copy = 2; children.has(id); copy++) {
        id = `${item.id}/${result.name}#${copy}`
      }
      const child = item.children.get(id) ?? this._controller.createTestItem(id, result.name)
      child.description = result.points.join(", ")
      children.set(id, [child, result])
    }
    item.children.replace([...children.values()].map(([child]) => child))
    const findFile = createSourceFileFinder(exercise.uri.fsPath)
    const outcomes = await Promise.all(
      [...children.values()].map(async ([child, result]) => ({
        child,
        failure: result.successful
          ? undefined
          : await failureMessage(result, exercise.uri.fsPath, findFile),
      })),
    )
    for (const { child, failure } of outcomes) {
      if (failure) {
        run.failed(child, failure)
      } else {
        run.passed(child)
      }
    }
  }

  private _offerSubmit(
    exercise: WorkspaceExercise,
    outcome: ExerciseTestOutcome,
    isAllPassed: boolean,
  ): void {
    let message: string
    if (outcome.kind === "examMode") {
      message = "Tests are not run locally in exam mode."
    } else if (isAllPassed && !outcome.isCourseDisabled) {
      message = `All tests of ${exercise.exerciseSlug} passed.`
    } else {
      return
    }
    if (!this._actionContext.authState.loggedIn) {
      return
    }
    void this._actionContext.dialog.notification(message, [
      "Submit",
      (): void => void vscode.commands.executeCommand("tmc.submitExercise", exercise.uri),
    ])
  }
}

/** Why a run produced no per-test results, or `undefined` when it did. */
function runFailure(runResult: RunResult): string | undefined {
  const output = Object.values(runResult.logs)
    .filter((text) => text.trim() !== "")
    .join("\n")
  const withOutput = (headline: string): string => (output ? `${headline}\n\n${output}` : headline)
  switch (runResult.status) {
    case "COMPILE_FAILED":
      return withOutput("The exercise did not compile.")
    case "GENERIC_ERROR":
      return withOutput("The tests could not be run.")
    case "TESTRUN_INTERRUPTED":
      return withOutput("The test run was interrupted before it finished.")
    default:
      return runResult.testResults.length === 0 && runResult.status !== "PASSED"
        ? withOutput("The tests reported no results.")
        : undefined
  }
}

// The Test Results terminal needs CRLF line endings.
function toTerminalText(text: string): string {
  return text.replaceAll(/\r?\n/g, "\r\n")
}
