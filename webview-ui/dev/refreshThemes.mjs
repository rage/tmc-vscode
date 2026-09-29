// Regenerates dev/vscodeThemes.json: the `--vscode-*` variables a real VS Code hands a webview
// under each default theme, limited to the ones this app or @vscode-elements reads. Takes the VS
// Code executable to launch; the default is the newest build the test tiers put in ../.vscode-test.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"

import { _electron as electron } from "@playwright/test"

const webviewRoot = join(import.meta.dirname, "..")
const outputPath = join(import.meta.dirname, "vscodeThemes.json")

const THEMES = [
  "Dark Modern",
  "Light Modern",
  "Dark 2026",
  "Light 2026",
  "Default High Contrast",
  "Default High Contrast Light",
]

function findExecutable() {
  const cache = join(webviewRoot, "..", ".vscode-test")
  const builds = existsSync(cache)
    ? readdirSync(cache)
        .filter((name) => /^vscode-linux-x64-\d+\.\d+\.\d+$/.test(name))
        .toSorted((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    : []
  const newest = builds.at(-1)
  if (!newest) {
    throw new Error(
      "No VS Code build in .vscode-test; run the integration tests once or pass an executable path.",
    )
  }
  return join(cache, newest, "code")
}

function* sourceFiles(directory, extensions) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      yield* sourceFiles(path, extensions)
    } else if (extensions.some((extension) => entry.name.endsWith(extension))) {
      yield path
    }
  }
}

function referencedVariables(extraText) {
  const files = [
    ...sourceFiles(join(webviewRoot, "src"), [".svelte", ".css", ".ts"]),
    ...sourceFiles(join(webviewRoot, "node_modules", "@vscode-elements", "elements", "dist"), [
      ".js",
    ]),
  ]
  const names = new Set()
  for (const text of [...files.map((file) => readFileSync(file, "utf8")), extraText]) {
    for (const [name] of text.matchAll(/--vscode-[\w-]+/g)) {
      names.add(name)
    }
  }
  return names
}

// Undefined for any frame that is not a webview document VS Code has themed.
function captureFrame(frame) {
  return frame
    .evaluate(() => {
      const style = document.documentElement.style
      if (!style.getPropertyValue("--vscode-foreground")) {
        return undefined
      }
      const variables = {}
      for (const name of style) {
        if (name.startsWith("--vscode-")) {
          variables[name] = style.getPropertyValue(name).trim()
        }
      }
      return {
        kind: document.body.dataset.vscodeThemeKind,
        themeId: document.body.dataset.vscodeThemeId,
        variables,
        defaultStyles: document.querySelector("#_defaultStyles")?.textContent ?? "",
      }
    })
    .catch(() => undefined)
}

// The markdown preview is a built-in webview, so opening a README gets one without an extension.
async function captureWebview(executablePath, themeId) {
  const userDataDir = mkdtempSync(join(tmpdir(), "tmc-themes-user"))
  const workspaceDir = mkdtempSync(join(tmpdir(), "tmc-themes-workspace"))
  writeFileSync(join(workspaceDir, "README.md"), "# Theme capture\n")
  mkdirSync(join(userDataDir, "User"))
  writeFileSync(
    join(userDataDir, "User", "settings.json"),
    JSON.stringify({ "workbench.colorTheme": themeId, "workbench.startupEditor": "readme" }),
  )
  const app = await electron.launch({
    executablePath,
    args: [
      "--disable-gpu",
      "--no-sandbox",
      "--disable-extensions",
      "--disable-workspace-trust",
      "--skip-release-notes",
      "--new-window",
      `--user-data-dir=${userDataDir}`,
      workspaceDir,
    ],
  })
  try {
    const window = await app.firstWindow()
    for (let attempt = 0; attempt < 120; attempt++) {
      const captures = await Promise.all(window.frames().map((frame) => captureFrame(frame)))
      const capture = captures.find(Boolean)
      if (capture) {
        if (capture.themeId !== themeId) {
          throw new Error(`Asked for theme "${themeId}" but VS Code applied "${capture.themeId}"`)
        }
        return capture
      }
      await window.waitForTimeout(500)
    }
    throw new Error(`No webview appeared for theme "${themeId}"`)
  } finally {
    await app.close()
    rmSync(userDataDir, { recursive: true, force: true })
    rmSync(workspaceDir, { recursive: true, force: true })
  }
}

const executablePath = process.argv[2] ?? findExecutable()
const product = JSON.parse(
  readFileSync(join(dirname(executablePath), "resources", "app", "package.json"), "utf8"),
)

const captures = []
for (const themeId of THEMES) {
  console.log(`Capturing ${themeId}…`)
  captures.push({ id: themeId, ...(await captureWebview(executablePath, themeId)) })
}

const webviewDefaultStyles = captures[0].defaultStyles
const variableNames = [...referencedVariables(webviewDefaultStyles)].toSorted()

const vendored = {
  vscodeVersion: product.version,
  variableNames,
  webviewDefaultStyles,
  themes: captures.map(({ id, kind, variables }) => ({
    id,
    kind,
    variables: Object.fromEntries(
      variableNames.filter((name) => name in variables).map((name) => [name, variables[name]]),
    ),
  })),
}
writeFileSync(outputPath, `${JSON.stringify(vendored, null, 2)}\n`)
console.log(
  `Wrote ${relative(process.cwd(), outputPath)}: VS Code ${product.version}, ${variableNames.length} variables`,
)
