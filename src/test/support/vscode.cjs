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

module.exports = vscode
