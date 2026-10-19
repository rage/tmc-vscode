import { vi } from "vitest"
import * as vscode from "vscode"

import { closeTrustEditorWhenTrusted } from "../../window/workspaceTrustEditor"

const grantTrust = (): void =>
  (
    vscode.workspace as unknown as { grantWorkspaceTrustForTest: () => void }
  ).grantWorkspaceTrustForTest()

suite("closeTrustEditorWhenTrusted", function () {
  const initialTabGroups = vscode.window.tabGroups
  let close: ReturnType<typeof vi.fn>

  function activeTab(tab: { label: string; input: unknown }): void {
    close = vi.fn(async () => true)
    Object.defineProperty(vscode.window, "tabGroups", {
      value: { activeTabGroup: { activeTab: tab }, close },
      configurable: true,
    })
  }

  afterEach(function () {
    Object.defineProperty(vscode.window, "tabGroups", {
      value: initialTabGroups,
      configurable: true,
    })
  })

  test("closes the Workspace Trust editor VS Code leaves open after Trust", function () {
    const trustEditor = { label: "Workspace Trust", input: undefined }
    activeTab(trustEditor)
    closeTrustEditorWhenTrusted()

    grantTrust()

    expect(close).toHaveBeenCalledExactlyOnceWith(trustEditor)
  })

  test("leaves the student's editor alone when trust came some other way", function () {
    activeTab({ label: "main.py", input: { uri: vscode.Uri.file("/exercises/main.py") } })
    closeTrustEditorWhenTrusted()

    grantTrust()

    expect(close).not.toHaveBeenCalled()
  })

  test("acts on the next grant only", function () {
    const trustEditor = { label: "Workspace Trust", input: undefined }
    activeTab(trustEditor)
    closeTrustEditorWhenTrusted()
    closeTrustEditorWhenTrusted()

    grantTrust()
    grantTrust()

    expect(close).toHaveBeenCalledOnce()
  })
})
