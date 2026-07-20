import { vi } from "vitest"
import type * as vscode from "vscode"

import { autoMock } from "../support/mock"

type Memento = vscode.Memento & { setKeysForSync: (keys: string[]) => void }

/**
 * Creates a `vscode.ExtensionContext` mock backed by an in-memory globalState.
 */
export function createMockContext(): vscode.ExtensionContext {
  const globalState = createMockMemento()
  return new Proxy(autoMock<vscode.ExtensionContext>(), {
    get(target, prop) {
      if (prop === "globalState") {
        return globalState
      }
      return Reflect.get(target, prop)
    },
  })
}

/**
 * Creates a `vscode.Memento` mock that wraps a plain Map.
 */
export function createMockMemento(): Memento {
  const storage = new Map<string, unknown>()
  return {
    keys: () => [...storage.keys()],
    get: <T>(key: string, defaultValue?: T): T | undefined =>
      (storage.has(key) ? storage.get(key) : defaultValue) as T | undefined,
    update: async (key: string, value: unknown): Promise<void> => {
      storage.set(key, value)
    },
    setKeysForSync: () => {},
  }
}

/**
 * Creates a `vscode.WorkspaceConfiguration` mock whose `update` is a spy.
 */
export function createMockWorkspaceConfiguration(): vscode.WorkspaceConfiguration {
  return {
    get: vi.fn(),
    has: vi.fn(() => false),
    inspect: vi.fn(),
    update: vi.fn(async () => {}),
  } as unknown as vscode.WorkspaceConfiguration
}
