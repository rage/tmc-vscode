import { expect } from "@playwright/test"
import type { Locator } from "@playwright/test"

import { TmcPage } from "./tmc"

/** VS Code's Test Results view, where the TestMyCode test controller reports local runs. */
export class TestResultsPage extends TmcPage {
  /**
   * Opens the view from the command palette. VS Code opens it by itself when a run starts,
   * but only once a workbench part it starts lazily after activation is up, which a test
   * clicking right after startup can beat.
   */
  public async open(): Promise<void> {
    await this.page.keyboard.press("F1")
    const palette = this.page.locator(".quick-input-widget")
    await palette.locator("input").fill(">Test Results: Focus on Test Results View")
    await palette
      .locator(".quick-input-list .monaco-list-row")
      .filter({ hasText: "Focus on Test Results View" })
      .first()
      .click()
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
