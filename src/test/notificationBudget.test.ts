import * as fs from "fs"
import * as path from "path"

import * as ts from "typescript"

// Every toast, status message and progress notification interrupts the student; screens are
// where an outcome belongs. This pins each file's count, so a new one is a decision a reviewer
// sees in this map, and one moved into a screen has to lower it.

/** The calls counted, by the name they are called through. */
const COUNTED_METHODS = new Set([
  "notification",
  "warningNotification",
  "errorNotification",
  "progressNotification",
  "reportError",
  "statusMessage",
  "offer",
  "showInformationMessage",
  "showWarningMessage",
  "showErrorMessage",
  "withProgress",
])

// `withOperation` toasts unless it is silent or shows the failure in a screen.
const COUNTED_FUNCTIONS = new Set(["withOperation", "reportWarnings"])

// The mechanism itself, which the counted call sites go through.
const IMPLEMENTATIONS = new Set(["src/api/dialog.ts", "src/api/withOperation.ts"])

type Budget = Record<string, Record<string, number>>

const BUDGET: Budget = {
  "src/actions/downloadOrUpdateExercises.ts": { progressNotification: 1 },
  "src/api/aiUseGate.ts": { warningNotification: 1 },
  "src/commands/addNewCourse.ts": { reportError: 1, withOperation: 1 },
  "src/commands/changeTmcDataPath.ts": {
    errorNotification: 1,
    notification: 1,
    warningNotification: 1,
    withOperation: 1,
  },
  "src/commands/cleanExercise.ts": { statusMessage: 1 },
  "src/commands/downloadExercisesOfCourse.ts": {
    reportError: 1,
    statusMessage: 2,
    withOperation: 1,
  },
  "src/commands/downloadNewExercises.ts": { reportError: 1, withOperation: 1 },
  "src/commands/handOverExercises.ts": { notification: 3, withOperation: 2 },
  "src/commands/login.ts": { statusMessage: 1 },
  "src/commands/logout.ts": { statusMessage: 1, withOperation: 1 },
  "src/commands/offerCourseWorkspace.ts": { notification: 1 },
  "src/commands/openExercisesFolder.ts": { errorNotification: 1 },
  "src/commands/openNextExercise.ts": { errorNotification: 1, reportError: 1, withOperation: 1 },
  "src/commands/openWorkspace.ts": { withOperation: 1 },
  "src/commands/refreshEverything.ts": { notification: 2, reportWarnings: 1, withOperation: 2 },
  "src/commands/removeCourse.ts": { reportError: 1, statusMessage: 1, withOperation: 1 },
  "src/commands/resetExercise.ts": { progressNotification: 1, statusMessage: 1 },
  "src/commands/runForExercise.ts": { errorNotification: 1, withOperation: 1 },
  "src/commands/showExerciseResults.ts": { errorNotification: 2 },
  "src/commands/showModelSolution.ts": { errorNotification: 1, notification: 1 },
  "src/commands/switchWorkspace.ts": { reportError: 1 },
  "src/commands/updateExercises.ts": {
    notification: 2,
    reportError: 1,
    statusMessage: 2,
    withOperation: 2,
  },
  "src/commands/wipe.ts": { errorNotification: 1, warningNotification: 1, withOperation: 1 },
  "src/extension.ts": {
    errorNotification: 2,
    notification: 1,
    offer: 1,
    statusMessage: 1,
    warningNotification: 2,
    withProgress: 1,
  },
  "src/init/commands.ts": { reportError: 1, statusMessage: 1 },
  "src/init/ensureLangsUpdated.ts": { progressNotification: 1 },
  "src/panels/TmcPanel.ts": { offer: 1 },
  "src/panels/router.ts": { reportError: 1 },
  "src/storage/migration/exerciseData.ts": { progressNotification: 1, warningNotification: 1 },
  "src/testing/exerciseTestController.ts": { notification: 3, warningNotification: 2 },
  "src/ui/treeview/treeCommands.ts": { statusMessage: 2, warningNotification: 1, withOperation: 5 },
}

const repositoryRoot = path.join(__dirname, "..", "..")

function sourceFiles(): string[] {
  const sourceRoot = path.join(repositoryRoot, "src")
  return fs
    .readdirSync(sourceRoot, { recursive: true, encoding: "utf8" })
    .map((file) => `src/${file.split(path.sep).join("/")}`)
    .filter(
      (file) =>
        file.endsWith(".ts") &&
        !file.endsWith(".d.ts") &&
        !file.startsWith("src/test/") &&
        !file.startsWith("src/test-integration/") &&
        !IMPLEMENTATIONS.has(file),
    )
    .toSorted()
}

function isShownWithoutToast(call: ts.CallExpression): boolean {
  const options = call.arguments[1]
  return (
    options !== undefined &&
    ts.isObjectLiteralExpression(options) &&
    options.properties.some(
      (property) =>
        property.name !== undefined &&
        ts.isIdentifier(property.name) &&
        (property.name.text === "shownIn" ||
          (property.name.text === "silent" &&
            ts.isPropertyAssignment(property) &&
            property.initializer.kind === ts.SyntaxKind.TrueKeyword)),
    )
  )
}

function countCalls(file: string, text: string): Record<string, number> {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const counts: Record<string, number> = {}
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      const name = ts.isPropertyAccessExpression(callee)
        ? COUNTED_METHODS.has(callee.name.text) && callee.name.text
        : ts.isIdentifier(callee) &&
          COUNTED_FUNCTIONS.has(callee.text) &&
          !(callee.text === "withOperation" && isShownWithoutToast(node)) &&
          callee.text
      if (name) {
        counts[name] = (counts[name] ?? 0) + 1
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return counts
}

function measure(): Budget {
  const measured: Budget = {}
  for (const file of sourceFiles()) {
    const counts = countCalls(file, fs.readFileSync(path.join(repositoryRoot, file), "utf8"))
    if (Object.keys(counts).length > 0) {
      measured[file] = Object.fromEntries(Object.entries(counts).toSorted())
    }
  }
  return measured
}

suite("the notification budget", function () {
  test("each file interrupts the student exactly as often as the budget allows", function () {
    const measured = measure()
    const changes = [...new Set([...Object.keys(BUDGET), ...Object.keys(measured)])]
      .toSorted()
      .flatMap((file) => {
        const allowed = BUDGET[file] ?? {}
        const actual = measured[file] ?? {}
        return [...new Set([...Object.keys(allowed), ...Object.keys(actual)])].flatMap((kind) => {
          const [was, is] = [allowed[kind] ?? 0, actual[kind] ?? 0]
          if (was === is) {
            return []
          }
          const verdict = is > was ? "over budget" : "under budget: lower it"
          return [`${file} ${kind}: ${is}, budget ${was} (${verdict})`]
        })
      })
    expect(changes, `Update BUDGET to:\n${JSON.stringify(measured, null, 2)}`).toEqual([])
  })

  test("counts what toasts and skips what a screen shows", function () {
    const counts = countCalls(
      "fixture.ts",
      `
      dialog.notification("a")
      void dialog.reportError("b", error)
      withOperation(dialog, { failure: "c" }, body)
      withOperation(dialog, { failure: "d", silent: true }, body)
      withOperation(dialog, { failure: "e", silent: false }, body)
      withOperation(dialog, { failure: "f", shownIn: sink }, body)
      vscode.window.showErrorMessage("g")
    `,
    )
    expect(counts).toEqual({
      notification: 1,
      reportError: 1,
      withOperation: 2,
      showErrorMessage: 1,
    })
  })
})
