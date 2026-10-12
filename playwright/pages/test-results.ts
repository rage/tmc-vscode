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
    await this.runPaletteCommand("View: Focus into Panel")
    const tab = this.page.getByRole("tab", { name: "Test Results" })
    await tab.click()
    await expect(tab).toHaveAttribute("aria-selected", "true")
  }

  /** A row of the view's results tree: a run, an exercise, a test or a failure message. */
  public result(text: string): Locator {
    return this.page.getByRole("treeitem").filter({ hasText: text })
  }
}
