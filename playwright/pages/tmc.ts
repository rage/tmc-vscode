import type { FrameLocator, Locator, Page } from "@playwright/test"

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

  /**
   * The toast VS Code pops for a `Dialog` notification, matched on `text`.
   *
   * Scoped to the toast list because VS Code also mirrors every notification into
   * an off-screen `.monaco-alert` aria-live node, so an unscoped text match
   * resolves to two elements for a single notification. A notification genuinely
   * raised twice still stacks two toasts here and trips strict mode.
   */
  public notificationToast(text: string): Locator {
    return this.page.locator(".notifications-toasts").getByText(text)
  }

  public getSidePanel(): FrameLocator {
    return this.page.frameLocator(`.webview.ready`).last().frameLocator("iframe#active-frame")
  }
}
