import { Mock } from "typemoq";
import * as vscode from "vscode";

/**
 * Creates a new `vscode.ExtensionContext` mock object that uses mocked globalState.
 */
export function createMockContext(): vscode.ExtensionContext {
    const mockContext = Mock.ofType<vscode.ExtensionContext>();

    const memento = createMockMemento();
    mockContext.setup((x) => x.globalState).returns(() => memento);

    return mockContext.object;
}

/**
 * Creates a new `vscode.Memento` mock object that wraps a map object.
 */
export function createMockMemento(): vscode.Memento {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const storage = new Map<string, any>();
    const mockMemento = Mock.ofType<vscode.Memento>();
    mockMemento.setup((x) => x.get).returns(() => <T>(x: string): T | undefined => storage.get(x));
    mockMemento
        .setup((x) => x.update)
        .returns(() => async (key, value): Promise<void> => {
            storage.set(key, value);
        });
    return mockMemento.object;
}
