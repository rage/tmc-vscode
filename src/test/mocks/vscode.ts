import type { IMock } from "typemoq"
import { It, Mock } from "typemoq"
import type * as vscode from "vscode"

type Memento = vscode.Memento & { setKeysForSync: (keys: string[]) => void }

/**
 * Creates a new `vscode.ExtensionContext` mock object that uses mocked globalState.
 */
export function createMockContext(): vscode.ExtensionContext {
  const mockContext = Mock.ofType<vscode.ExtensionContext>()

  const memento = createMockMemento()
  mockContext.setup((x) => x.globalState).returns(() => memento)

  return mockContext.object
}

/**
 * Creates a new `vscode.Memento` mock object that wraps a map object.
 */
export function createMockMemento(): Memento {
  const storage = new Map<string, unknown>()
  const mockMemento = Mock.ofType<Memento>()
  mockMemento
    .setup((x) => x.get)
    .returns(
      () =>
        <T>(x: string): T | undefined =>
          storage.get(x) as T | undefined,
    )
  mockMemento
    .setup((x) => x.update)
    .returns(() => async (key, value): Promise<void> => {
      storage.set(key, value)
    })
  return mockMemento.object
}

export function createMockWorkspaceConfiguration(): IMock<vscode.WorkspaceConfiguration> {
  const mockWorkspaceConfiguration = Mock.ofType<vscode.WorkspaceConfiguration>()

  mockWorkspaceConfiguration
    .setup((x) => x.update(It.isAny(), It.isAny(), It.isAny()))
    .returns(async () => {})

  return mockWorkspaceConfiguration
}
