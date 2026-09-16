import { expect } from "@playwright/test"
import type { FrameLocator, Locator, Page } from "@playwright/test"

const MAX_ACTIVATION_CLICKS = 3
const ACTIVATION_TIMEOUT_MS = 10_000

// A target inside a webview frame that VS Code has not created yet cannot be
// queried at all, which is "not visible yet" rather than a failure.
async function isVisibleNow(target: Locator): Promise<boolean> {
  try {
    return await target.isVisible()
  } catch {
    return false
  }
}

/**
 * Clicks `trigger` until `target` becomes visible, at most
 * {@link MAX_ACTIVATION_CLICKS} times.
 *
 * VS Code renders the extension's activity bar entry and its tree view before
 * the extension host has finished activating, and a click landing in that
 * window opens nothing and reports no error -- so the click has to be retried
 * against its outcome. `description` names the outcome in the failure message.
 */
export async function clickUntilVisible(
  trigger: Locator,
  target: Locator,
  description: string,
): Promise<void> {
  await trigger.waitFor()
  let remainingClicks = MAX_ACTIVATION_CLICKS
  await expect
    .poll(
      async () => {
        if (!(await isVisibleNow(target)) && remainingClicks > 0) {
          remainingClicks--
          await trigger.click()
        }
        return isVisibleNow(target)
      },
      {
        timeout: ACTIVATION_TIMEOUT_MS,
        message: `${description} after ${MAX_ACTIVATION_CLICKS} clicks`,
      },
    )
    .toBe(true)
}

export class TmcPage {
  public constructor(
    public readonly page: Page,
    public readonly webview: FrameLocator,
  ) {}

  public async openMenu(): Promise<void> {
    // Specific enough not to conflict with the "Welcome to TestMyCode" tab.
    const activityBarEntry = this.page
      .locator('[id="workbench\\.parts\\.activitybar"]')
      .getByRole("tab", { name: "TestMyCode" })
      .locator("a")
    await clickUntilVisible(
      activityBarEntry,
      this.page.getByRole("heading", { name: "TestMyCode: Menu" }),
      "the TestMyCode menu did not open",
    )
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
