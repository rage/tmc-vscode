import { expect } from "@playwright/test"
import type { Locator, Page } from "@playwright/test"

/**
 * VS Code's native quick pick (`Dialog.selectItem` in src/api/dialog.ts). It is
 * workbench chrome, not a webview, so it is located on `page` rather than
 * through a frame locator.
 */
export class QuickPickPage {
  public constructor(public readonly page: Page) {}

  private widget(): Locator {
    return this.page.locator(".quick-input-widget")
  }

  private rows(): Locator {
    return this.widget().locator(".quick-input-list .monaco-list-row")
  }

  /** Waits for a quick pick carrying `title` to be the one on screen. */
  public async waitForTitle(title: string): Promise<void> {
    await expect(this.widget().locator(".quick-input-title")).toHaveText(title)
  }

  public async selectByLabel(label: string): Promise<void> {
    await this.rows().filter({ hasText: label }).first().click()
  }

  /**
   * For pickers whose labels are generated (a submission's timestamp), where
   * asserting the count is the meaningful check and the label is not.
   */
  public async selectOnlyItem(): Promise<void> {
    await expect(this.rows()).toHaveCount(1)
    await this.rows().first().click()
  }

  public async expectClosed(): Promise<void> {
    await expect(this.widget()).toBeHidden()
  }
}
