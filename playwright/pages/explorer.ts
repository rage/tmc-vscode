import { expect } from "@playwright/test"
import type { Page } from "@playwright/test"

export class ExplorerPage {
  public constructor(public readonly page: Page) {}

  public async openFile(filename: string): Promise<void> {
    const folders = this.page.locator(".explorer-folders-view")
    // TestMyCode shows its Courses view once it has started in a window it opened, which may
    // replace the Explorer between any two steps here.
    await expect(async () => {
      await this.show()
      // A click on an expanded folder would collapse it.
      if (
        await folders
          .locator("div.collapsible:not(.collapsed) + div")
          .getByText(filename)
          .isVisible()
      ) {
        return
      }
      await folders.getByText(filename).click({ timeout: 2000 })
    }).toPass({ timeout: 30_000 })
  }

  public async openPath(path: string[]): Promise<void> {
    for (const file of path) {
      await this.openFile(file)
    }
  }

  /**
   * Runs one of the extension's exercise commands on a file node, through the
   * "TestMyCode" submenu the explorer context menu contributes (package.json,
   * `tmc.exercise`).
   */
  public async runContextMenuCommand(filename: string, command: string): Promise<void> {
    const submenu = this.page.locator(".monaco-menu").getByRole("menuitem", { name: "TestMyCode" })
    // The submenu appears only once the extension has started, and a course workspace lists its
    // exercises before that.
    await expect(async () => {
      await this.page.keyboard.press("Escape")
      await this.show()
      await this.page
        .locator(".explorer-folders-view")
        .getByText(filename)
        .click({ button: "right", timeout: 2000 })
      await expect(submenu).toBeVisible({ timeout: 2000 })
    }).toPass()
    await submenu.hover()
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

  /** Shows the Explorer unless it is up, as a click on its activity bar entry would hide it. */
  private async show(): Promise<void> {
    if (await this.page.locator(".explorer-folders-view").isVisible()) {
      return
    }
    await this.page
      .locator('[id="workbench\\.parts\\.activitybar"]')
      .getByRole("tab", { name: /^Explorer/ })
      .click()
  }
}
