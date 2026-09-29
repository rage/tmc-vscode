import { vi } from "vitest"
import * as vscode from "vscode"

/** A status bar item that records whether it is shown, which the vscode mock does not. */
export interface FakeStatusBarItem extends vscode.StatusBarItem {
  isShown: boolean
  isDisposed: boolean
}

/** Makes `createStatusBarItem` return fakes, and returns the list they are pushed to. */
export function fakeStatusBarItems(): FakeStatusBarItem[] {
  const created: FakeStatusBarItem[] = []
  vi.spyOn(vscode.window, "createStatusBarItem").mockImplementation(((
    id: string,
    alignment: vscode.StatusBarAlignment,
    priority: number,
  ) => {
    const item = {
      id,
      alignment,
      priority,
      name: undefined,
      text: "",
      isShown: false,
      isDisposed: false,
      show(): void {
        item.isShown = true
      },
      hide(): void {
        item.isShown = false
      },
      dispose(): void {
        item.isDisposed = true
      },
    } as unknown as FakeStatusBarItem
    created.push(item)
    return item
  }) as never)
  return created
}

/** A tooltip's markdown source. */
export function tooltipText(item: vscode.StatusBarItem): string {
  const { tooltip } = item
  return typeof tooltip === "string" ? tooltip : (tooltip?.value ?? "")
}
