import { expect } from "@playwright/test"
import type { Page } from "@playwright/test"

export class ExplorerPage {
  public constructor(public readonly page: Page) {
    // continuously check for the trust dialogues which
    // appears at unpredictable times
    page.addLocatorHandler(
      page.locator(".dialog-message-text").getByText("Do you trust"),
      async () => await this.page.getByRole("button", { name: "Yes" }).click(),
    )
  }

  public async openFile(filename: string): Promise<void> {
    // first, let's make sure that the target isn't a directory that's already open,
    // as naively clicking it would close it
    const isOpenDir = await this.page
      // selects the file explorer sidebar
      .locator(".explorer-folders-view")
      // selects collapsible elements in the sidebar that are not collapsed
      .locator("div.collapsible:not(.collapsed) + div")
      // gets an expanded collapsible element with the name we're looking for
      .getByText(filename)
      .isVisible()
    if (isOpenDir) {
      // if the target is an open directory, we shouldn't click it because that would close it
      return
    }

    // otherwise, click it
    await this.page
      // selects the file explorer sidebar
      .locator(".explorer-folders-view")
      // selects the actual file
      .getByText(filename)
      .click()
  }

  public async openPath(path: string[]): Promise<void> {
    for (const file of path) {
      await this.openFile(file)
    }
  }

  /**
   * Runs one of the extension's `explorer/context` commands (package.json, group
   * `TestMyCode`) on a file node. The group renders as flat items in the one
   * context menu, not a submenu.
   */
  public async runContextMenuCommand(filename: string, command: string): Promise<void> {
    await this.page.locator(".explorer-folders-view").getByText(filename).click({ button: "right" })
    const item = this.page.locator(".monaco-menu").getByRole("menuitem", { name: command })
    await expect(item).toBeVisible()
    // A synthetic click on a monaco menu item does not activate it -- the menu
    // stays open and the command never runs. Hovering focuses the item, and it
    // does respond to Enter.
    await item.hover()
    await this.page.keyboard.press("Enter")
    // The menu closing is the only signal the item was actually activated.
    await expect(item).toBeHidden()
  }
}
