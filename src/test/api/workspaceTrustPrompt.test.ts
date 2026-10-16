import { vi } from "vitest"
import * as vscode from "vscode"

import {
  promptForCourseWorkspaceTrust,
  requestWorkspaceTrust,
} from "../../api/workspaceTrustPrompt"
import { Logger, LogLevel } from "../../utilities"
import { createMockMemento } from "../mocks/vscode"

type WindowStateListener = (state: vscode.WindowState) => void

suite("workspace trust prompt", function () {
  let isTrusted: boolean
  let isFocused: boolean
  let startupPrompt: string | undefined
  let windowStateListeners: WindowStateListener[]
  /** What VS Code's trust modal answers, after how long. */
  let trustModal: { answer: "trust" | "cancel" | "none"; delayMs: number }
  let executeCommand: ReturnType<typeof vi.spyOn>
  let showWarningMessage: ReturnType<typeof vi.spyOn>
  let fetchTasks: ReturnType<typeof vi.spyOn>
  let workspaceState: vscode.Memento

  beforeEach(function () {
    Logger.configure(LogLevel.None)
    vi.useFakeTimers()
    isTrusted = false
    isFocused = true
    startupPrompt = "never"
    windowStateListeners = []
    trustModal = { answer: "trust", delayMs: 1000 }
    workspaceState = createMockMemento()
    Object.defineProperty(vscode.workspace, "isTrusted", {
      get: () => isTrusted,
      set: (value: boolean) => {
        isTrusted = value
      },
      configurable: true,
    })
    Object.defineProperty(vscode.window, "state", {
      get: () => ({ focused: isFocused, active: isFocused }),
      configurable: true,
    })
    vi.spyOn(vscode.window, "onDidChangeWindowState").mockImplementation(
      (listener: WindowStateListener) => {
        windowStateListeners.push(listener)
        return {
          dispose: () => windowStateListeners.splice(windowStateListeners.indexOf(listener), 1),
        }
      },
    )
    vi.spyOn(vscode.workspace, "getConfiguration").mockImplementation(
      (section?: string) =>
        ({
          get: (key: string) =>
            section === "security.workspace.trust" && key === "startupPrompt"
              ? startupPrompt
              : undefined,
        }) as unknown as vscode.WorkspaceConfiguration,
    )
    fetchTasks = vi.spyOn(vscode.tasks, "fetchTasks").mockImplementation(async () => {
      if (trustModal.answer === "none") {
        return []
      }
      await new Promise<void>((resolve) => {
        setTimeout(resolve, trustModal.delayMs)
      })
      isTrusted = trustModal.answer === "trust"
      return []
    })
    executeCommand = vi.spyOn(vscode.commands, "executeCommand").mockResolvedValue(undefined)
    showWarningMessage = vi.spyOn(vscode.window, "showWarningMessage")
  })

  afterEach(function () {
    vi.useRealTimers()
    vi.restoreAllMocks()
    Object.defineProperty(vscode.workspace, "isTrusted", {
      value: true,
      configurable: true,
      writable: true,
    })
  })

  suite("requestWorkspaceTrust", function () {
    test("asks through VS Code's trust modal", async function () {
      const request = requestWorkspaceTrust()
      await vi.runAllTimersAsync()
      await request

      expect(fetchTasks).toHaveBeenCalledOnce()
      expect(isTrusted).toBe(true)
      expect(executeCommand).not.toHaveBeenCalled()
    })

    test("accepts a refusal in the modal", async function () {
      trustModal.answer = "cancel"

      const request = requestWorkspaceTrust()
      await vi.runAllTimersAsync()
      await request

      expect(executeCommand).not.toHaveBeenCalled()
    })

    test("opens the trust editor where no modal comes up", async function () {
      trustModal.answer = "none"

      await requestWorkspaceTrust()

      expect(executeCommand).toHaveBeenCalledWith("workbench.trust.manage")
    })
    test("closes the trust editor it opened once the workspace is trusted", async function () {
      trustModal.answer = "none"
      const trustEditor = { label: "Workspace Trust", input: undefined }
      const close = vi.fn(async () => true)
      const initialTabGroups = vscode.window.tabGroups
      Object.defineProperty(vscode.window, "tabGroups", {
        value: { activeTabGroup: { activeTab: trustEditor }, close },
        configurable: true,
      })
      try {
        await requestWorkspaceTrust()
        ;(
          vscode.workspace as unknown as { grantWorkspaceTrustForTest: () => void }
        ).grantWorkspaceTrustForTest()
      } finally {
        Object.defineProperty(vscode.window, "tabGroups", {
          value: initialTabGroups,
          configurable: true,
        })
      }

      expect(close).toHaveBeenCalledExactlyOnceWith(trustEditor)
    })
  })

  suite("promptForCourseWorkspaceTrust", function () {
    test("asks nothing in a trusted window", async function () {
      isTrusted = true

      await promptForCourseWorkspaceTrust("Python Course", workspaceState)

      expect(showWarningMessage).not.toHaveBeenCalled()
      expect(fetchTasks).not.toHaveBeenCalled()
    })

    suite("where VS Code does not ask on startup", function () {
      test("explains first, then asks through VS Code", async function () {
        showWarningMessage.mockResolvedValue("Trust Course Workspace")

        const prompt = promptForCourseWorkspaceTrust("Python Course", workspaceState)
        await vi.runAllTimersAsync()
        await prompt

        expect(showWarningMessage).toHaveBeenCalledWith(
          expect.stringContaining("Python Course"),
          expect.objectContaining({ modal: true }),
          "Trust Course Workspace",
        )
        expect(fetchTasks).toHaveBeenCalledOnce()
        expect(isTrusted).toBe(true)
      })

      test("asks VS Code nothing once the student cancels", async function () {
        showWarningMessage.mockResolvedValue(undefined)

        await promptForCourseWorkspaceTrust("Python Course", workspaceState)

        expect(fetchTasks).not.toHaveBeenCalled()
      })
    })

    suite("where VS Code asks the first time a workspace opens", function () {
      beforeEach(function () {
        startupPrompt = "once"
      })

      test("leaves the first opening's question to VS Code, even once answered No", async function () {
        const prompt = promptForCourseWorkspaceTrust("Python Course", workspaceState)
        await vi.runAllTimersAsync()
        await prompt

        expect(fetchTasks).not.toHaveBeenCalled()
        expect(showWarningMessage).not.toHaveBeenCalled()
      })

      test("asks through VS Code on a later opening, which VS Code does not ask on", async function () {
        await promptForCourseWorkspaceTrust("Python Course", workspaceState)

        const prompt = promptForCourseWorkspaceTrust("Python Course", workspaceState)
        await vi.runAllTimersAsync()
        await prompt

        expect(fetchTasks).toHaveBeenCalledOnce()
        expect(showWarningMessage).not.toHaveBeenCalled()
      })

      test("asks a later opening only once the window has focus", async function () {
        await promptForCourseWorkspaceTrust("Python Course", workspaceState)
        isFocused = false

        const prompt = promptForCourseWorkspaceTrust("Python Course", workspaceState)
        await vi.advanceTimersByTimeAsync(10_000)
        expect(fetchTasks).not.toHaveBeenCalled()

        isFocused = true
        windowStateListeners.at(-1)?.({ focused: true, active: true })
        await vi.runAllTimersAsync()
        await prompt

        expect(fetchTasks).toHaveBeenCalledOnce()
      })

      test("does not count an opening that was already trusted", async function () {
        isTrusted = true
        await promptForCourseWorkspaceTrust("Python Course", workspaceState)
        isTrusted = false

        await promptForCourseWorkspaceTrust("Python Course", workspaceState)

        expect(fetchTasks).not.toHaveBeenCalled()
      })
    })

    test("leaves every question to VS Code where it asks on every startup", async function () {
      startupPrompt = "always"
      await promptForCourseWorkspaceTrust("Python Course", workspaceState)

      await promptForCourseWorkspaceTrust("Python Course", workspaceState)

      expect(fetchTasks).not.toHaveBeenCalled()
      expect(showWarningMessage).not.toHaveBeenCalled()
    })
  })
})
