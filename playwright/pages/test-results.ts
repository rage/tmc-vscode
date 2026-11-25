import { expect } from "@playwright/test"
import type { Locator } from "@playwright/test"

import { TmcPage } from "./tmc"

/** VS Code's Test Results view, where the TestMyCode test controller reports local runs. */
export class TestResultsPage extends TmcPage {
  /**
   * Shows the view in the panel once VS Code has a test result. Until then VS Code hides
   * the view, and a command palette opened meanwhile never lists its focus command.
   */
  public async open(): Promise<void> {
    // Not its tab: a narrow panel moves the tab into its "Additional Views" overflow.
    const command = "Test Results: Focus on Test Results View"
    const palette = this.page.locator(".quick-input-widget")
    await expect(async () => {
      // Reopened each time: an open palette keeps the list it had before the view existed.
      if (await palette.isVisible()) {
        await this.page.keyboard.press("Escape")
        await expect(palette).toBeHidden({ timeout: 2_000 })
      }
      await this.page.keyboard.press("F1")
      await palette.locator("input").fill(`>${command}`, { timeout: 2_000 })
      await palette
        .locator(".quick-input-list .monaco-list-row")
        .filter({ hasText: command })
        .first()
        .click({ timeout: 2_000 })
    }).toPass({ timeout: 30_000 })
    await expect(this.page.getByRole("tab", { name: "Test Results" })).toHaveAttribute(
      "aria-selected",
      "true",
    )
  }

  /** A row of the view's results tree: a run, an exercise, a test or a failure message. */
  public result(text: string): Locator {
    return this.page.getByRole("treeitem").filter({ hasText: text })
  }
}
