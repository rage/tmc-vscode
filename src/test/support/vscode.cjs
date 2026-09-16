// CommonJS so Vite's interop exposes the mock's members as named exports for
// `import * as vscode from "vscode"`. `vi` is available as a global (globals: true).
const { createVSCodeMock } = require("jest-mock-vscode")

const vscode = createVSCodeMock(vi)

// jest-mock-vscode does not ship every value-class the extension constructs at
// module load. Fill the gaps the extension host relies on.
if (typeof vscode.FileDecoration !== "function") {
  // oxlint-disable-next-line typescript/no-extraneous-class -- mirrors the vscode.FileDecoration constructor shape
  vscode.FileDecoration = class FileDecoration {
    constructor(badge, tooltip, color) {
      this.badge = badge
      this.tooltip = tooltip
      this.color = color
      this.propagate = false
    }
  }
}

// jest-mock-vscode returns `undefined` where the real API returns a `Disposable`, and
// the extension pushes what these return into `context.subscriptions`. Without a real
// disposable, a test that shuts a context down the way VS Code does walks an array of
// `undefined` and cannot tell a registered listener from a leaked one.
const registrationsReturningDisposables = [
  [vscode.commands, "registerCommand"],
  [vscode.window, "registerFileDecorationProvider"],
  [vscode.window, "registerTreeDataProvider"],
  [vscode.workspace, "onDidChangeConfiguration"],
  [vscode.workspace, "onDidChangeWorkspaceFolders"],
  [vscode.workspace, "onDidOpenTextDocument"],
]
for (const [namespace, name] of registrationsReturningDisposables) {
  const register = namespace[name]
  namespace[name] = vi.fn(
    (...args) => register?.apply(namespace, args) ?? new vscode.Disposable(() => {}),
  )
}

module.exports = vscode
