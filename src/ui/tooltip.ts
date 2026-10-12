import * as vscode from "vscode"

/**
 * A hover of a bold title, then one paragraph per line.
 *
 * The text is escaped, so a course or exercise name cannot inject markdown, links included.
 */
export function tooltipOf([title, ...lines]: readonly string[]): vscode.MarkdownString {
  const tooltip = new vscode.MarkdownString()
  tooltip
    .appendMarkdown("**")
    .appendText(title ?? "")
    .appendMarkdown("**")
  for (const line of lines) {
    tooltip.appendMarkdown("\n\n").appendText(line)
  }
  return tooltip
}
