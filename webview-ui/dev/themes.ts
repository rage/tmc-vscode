import vendored from "./vscodeThemes.json"

/** What a VS Code webview receives for one colour theme: its body class and `--vscode-*` values. */
export interface VsCodeTheme {
  id: string
  /** The body class VS Code sets, e.g. `vscode-dark`. */
  kind: "vscode-light" | "vscode-dark" | "vscode-high-contrast" | "vscode-high-contrast-light"
  /** Only the variables this theme resolves; VS Code leaves an unresolved one unset. */
  variables: Record<string, string>
}

/** The VS Code release `vscodeThemes.json` was captured from (`pnpm run themes:refresh`). */
export const VSCODE_VERSION: string = vendored.vscodeVersion

/**
 * Every `--vscode-*` name the capture looked for. A name listed here but missing from a theme's
 * `variables` is one VS Code leaves unset in that theme; a name not listed was never captured.
 */
export const CAPTURED_VARIABLE_NAMES: readonly string[] = vendored.variableNames

/** The host stylesheet VS Code injects into every webview, in `@layer vscode-default`. */
export const WEBVIEW_DEFAULT_STYLES: string = vendored.webviewDefaultStyles

/** The default themes of `VSCODE_VERSION`, in the order a theme picker should list them. */
export const VSCODE_THEMES = vendored.themes as VsCodeTheme[]

const BODY_CLASSES = [
  "vscode-light",
  "vscode-dark",
  "vscode-high-contrast",
  "vscode-high-contrast-light",
  "vscode-reduce-motion",
]

/**
 * Makes `document` look the way VS Code prepares a webview document for `theme`: the variables on
 * `<html>`, and the theme-kind and reduce-motion classes and data attributes on `<body>`.
 */
export function applyTheme(
  document: Document,
  theme: VsCodeTheme,
  { isMotionReduced = false }: { isMotionReduced?: boolean } = {},
): void {
  const style = document.documentElement.style
  for (let index = style.length - 1; index >= 0; index--) {
    const name = style.item(index)
    if (name.startsWith("--vscode-")) {
      style.removeProperty(name)
    }
  }
  for (const [name, value] of Object.entries(theme.variables)) {
    style.setProperty(name, value)
  }

  const body = document.body
  body.classList.remove(...BODY_CLASSES)
  body.classList.add(theme.kind)
  // VS Code keeps the pre-light-HC class on light HC for older webviews.
  if (theme.kind === "vscode-high-contrast-light") {
    body.classList.add("vscode-high-contrast")
  }
  if (isMotionReduced) {
    body.classList.add("vscode-reduce-motion")
  }
  body.dataset.vscodeThemeKind = theme.kind
  body.dataset.vscodeThemeId = theme.id
}
