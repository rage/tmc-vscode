import * as fs from "fs"
import * as path from "path"

// Terms the student-facing glossary replaces; matched case-insensitively.
const BANNED_TERMS = [
  "courses.mooc.fi account",
  "TMC account",
  "Sign In",
  "session expired",
  "session has expired",
  "session ended",
  "session has ended",
  "Could not refresh",
  "Course Details",
  "Add a Course",
  "Add Course...",
  "Add Course…",
  "passed locally",
  "Submit Solution",
  "Send for grading",
  "Exercise passed",
  "All tests passed on the server",
  "Not passed yet",
  "Share Exercise via Paste",
  "Send to courses.mooc.fi paste",
  "Download Old Submission",
  "Show History",
  "Reveal in Courses View",
  "Open in Course Material",
  "The teacher has not chosen",
]

// Hits that are not student-facing text, as "file: term". Keep each one justified.
const ALLOWED: string[] = []

const repoRoot = path.join(__dirname, "..", "..")

/** The student-facing sources: host and webview code, shared code, the manifest, walkthrough. */
function scannedFiles(): string[] {
  const walk = (dir: string): string[] =>
    fs
      .readdirSync(path.join(repoRoot, dir), { recursive: true, encoding: "utf8" })
      .map((file) => path.join(dir, file))
      .filter((file) => /\.(ts|svelte|md)$/.test(file))
      .filter((file) => !/(\.test\.ts$|[/\\](test|test-integration|generated)[/\\])/.test(file))
  return [
    ...walk("src"),
    ...walk("shared"),
    ...walk(path.join("webview-ui", "src")),
    ...walk(path.join("media", "walkthrough")),
    "package.json",
  ].toSorted()
}

/** `source` without comments, which name things for developers rather than students. */
function withoutComments(file: string, source: string): string {
  if (!/\.(ts|svelte)$/.test(file)) {
    return source
  }
  return (
    source
      .replaceAll(/\/\*[\s\S]*?\*\//g, "")
      .replaceAll(/<!--[\s\S]*?-->/g, "")
      // Not `://`, so URLs in strings survive.
      .replaceAll(/(^|[^:"'`])\/\/.*$/gm, "$1")
  )
}

/** Log lines are for developers too. */
function withoutLogCalls(source: string): string {
  return source.replaceAll(/Logger\.(trace|debug|info|warn|error)\([\s\S]*?\)\n/g, "")
}

/** Every banned term in the in-scope sources, as "file: term". */
function bannedTermHits(): string[] {
  return scannedFiles().flatMap((file) => {
    const raw = fs.readFileSync(path.join(repoRoot, file), "utf8")
    const text = withoutLogCalls(withoutComments(file, raw)).toLowerCase()
    return BANNED_TERMS.filter((term) => text.includes(term.toLowerCase())).map(
      (term) => `${file.split(path.sep).join("/")}: ${term}`,
    )
  })
}

suite("student-facing text follows the glossary", function () {
  test("no in-scope source uses a banned term", function () {
    expect(bannedTermHits().filter((hit) => !ALLOWED.includes(hit))).toEqual([])
  })

  test("every allowed exception still occurs, so the list does not go stale", function () {
    const hits = bannedTermHits()
    expect(ALLOWED.filter((allowed) => !hits.includes(allowed))).toEqual([])
  })

  test("no command is titled just Close", function () {
    const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
      contributes: { commands: { command: string; title: string }[] }
    }
    const bare = manifest.contributes.commands.filter(({ title }) => title === "Close")
    expect(bare.map(({ command }) => command)).toEqual([])
  })
})
