import type { FrameLocator, Page } from "@playwright/test"

export class TmcPage {
  public constructor(
    public readonly page: Page,
    public readonly webview: FrameLocator,
  ) {}

  public async openMenu(): Promise<void> {
    // for some reason the extension button doesn't work properly for some reason,
    // so we'll just keep clicking until it works...
    while (!(await this.page.getByRole("heading", { name: "TestMyCode: Menu" }).isVisible())) {
      // the locator is very specific to not conflict with the "Welcome to TestMyCode" tab
      await this.page
        .locator('[id="workbench\\.parts\\.activitybar"]')
        .getByRole("tab", { name: "TestMyCode" })
        .locator("a")
        .click()
      // oxlint-disable-next-line playwright/no-wait-for-timeout -- deliberate settle-delay while polling flaky VS Code webview UI
      await this.page.waitForTimeout(200)
    }
  }

  public getSidePanel(): FrameLocator {
    return this.page.frameLocator(`.webview.ready`).last().frameLocator("iframe#active-frame")
  }
}
