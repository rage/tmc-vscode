import * as vscode from "vscode"

suite("the vscode mock", () => {
  test("every registration the extension makes returns a disposable", () => {
    // The extension pushes each of these into `context.subscriptions`, so a mock
    // returning `undefined` fills that array with nothing to dispose and hides a
    // leaked listener from any test that shuts a context down.
    const registrations = [
      (): unknown => vscode.commands.registerCommand("tmc.mockProbe", () => {}),
      (): unknown =>
        vscode.window.registerFileDecorationProvider({ provideFileDecoration: () => undefined }),
      (): unknown =>
        vscode.window.registerTreeDataProvider("tmc.mockProbe", {
          getTreeItem: (element: never) => element,
          getChildren: () => [],
        }),
      (): unknown => vscode.workspace.onDidChangeConfiguration(() => {}),
      (): unknown => vscode.workspace.onDidChangeWorkspaceFolders(() => {}),
      (): unknown => vscode.workspace.onDidOpenTextDocument(() => {}),
    ]

    for (const register of registrations) {
      const registration = register() as { dispose?: unknown }
      expect(typeof registration?.dispose).toBe("function")
    }
  })
})
