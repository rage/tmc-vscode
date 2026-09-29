import * as fs from "fs"
import * as path from "path"

// `.oxlintrc.json` bans the prompts and toasts in src/actions by name; what a rule cannot
// express is which failures an operation may report itself, so that is pinned here.

const actionsRoot = path.join(__dirname, "..", "actions")

function actionSources(): [file: string, source: string][] {
  return fs
    .readdirSync(actionsRoot, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".ts"))
    .toSorted()
    .map((file) => [file, fs.readFileSync(path.join(actionsRoot, file), "utf8")])
}

/** The first argument of each call to `callee`, or "<computed>" when it is not a literal. */
function firstArguments(source: string, callee: string): string[] {
  return [...source.matchAll(new RegExp(`\\b${callee}\\b(\\s*\\(\\s*(["\`])(.*?)\\2)?`, "gs"))].map(
    (match) => match[3] ?? "<computed>",
  )
}

// Failures an operation carried on past, so no entry point hears of them. The failure an
// operation returns is never reported by the operation: `withOperation` does that.
const carriedOnPastWarnings = [
  "downloadExercisesForUi.ts: Failed to refresh local exercises.",
  "downloadExercisesForUi.ts: Failed to read the course.",
  "downloadExercisesForUi.ts: Failed to refresh local exercises.",
  "downloadOrUpdateExercises.ts: Failed to download exercises from tmc.mooc.fi.",
  "downloadOrUpdateExercises.ts: Failed to download exercises from courses.mooc.fi.",
  "downloadOrUpdateExercises.ts: Failed to update exercises.",
  "downloadOrUpdateExercises.ts: Failed to update exercises.",
  // both backends failed: the tmc half is returned, the mooc half is this
  'logout.ts: Failed to log out of ${backendName("mooc")}.',
  'removeCourse.ts: Failed to remove TMC-langs data for "${courseName}".',
  'removeCourse.ts: Failed to remove the workspace file for "${courseName}".',
  "submitExercise.ts: Failed to record the exercise as passed.",
  // once per session; the only way a background poll tells the user their scope is gone
  "updateCourse.ts: Failed to update course data.",
]

suite("the operation layer contract", function () {
  test("an operation reports only the failures it carried on past", function () {
    const reported = actionSources().flatMap(([file, source]) =>
      firstArguments(source, "reportError").map((headline) => `${file}: ${headline}`),
    )
    expect(reported).toEqual(carriedOnPastWarnings)
  })

  test("an operation uses no dialog but reportError and a nested progress bar", function () {
    const used = actionSources().flatMap(([file, source]) =>
      [...source.matchAll(/\bdialog\s*\??\.\s*(\w+)/g)].map((match) => `${file}: ${match[1]}`),
    )
    expect(used.filter((use) => !/: (reportError|progressNotification)$/.test(use))).toEqual([])
  })

  test("an operation never routes into one of the extension's own commands", function () {
    const routed = actionSources().flatMap(([file, source]) =>
      firstArguments(source, "executeCommand")
        .filter((command) => command === "<computed>" || command.startsWith("tmc"))
        .map((command) => `${file}: ${command}`),
    )
    expect(routed).toEqual([])
  })
})
