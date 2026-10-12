import * as fs from "fs"
import * as path from "path"

// `.oxlintrc.json` bans the prompts and toasts in src/actions by name; what a rule cannot
// express is which command an operation routes into.

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

suite("the operation layer contract", function () {
  test("an operation never routes into one of the extension's own commands", function () {
    const routed = actionSources().flatMap(([file, source]) =>
      firstArguments(source, "executeCommand")
        .filter((command) => command === "<computed>" || command.startsWith("tmc"))
        .map((command) => `${file}: ${command}`),
    )
    expect(routed).toEqual([])
  })
})
