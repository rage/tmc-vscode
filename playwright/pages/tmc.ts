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
 * against its outcome. `description` is suffixed with "after N clicks" in the
 * failure message, so phrase it as "the X did not open".
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

/**
 * Waits for `target`, inside a webview, to be visible. VS Code replaces a webview's frame when it
 * reloads the document, which ends a plain wait on the old frame at once.
 */
export async function expectVisibleInWebview(target: Locator, timeout = 30_000): Promise<void> {
  await expect(async () => {
    await expect(target).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout })
}

export class TmcPage {
  public constructor(
    public readonly page: Page,
    public readonly webview: FrameLocator,
  ) {}

  public async openMenu(): Promise<void> {
    // Scoped to the activity bar: editor tabs such as "TestMyCode Help" share the name.
    const activityBarEntry = this.page
      .locator('[id="workbench\\.parts\\.activitybar"]')
      .getByRole("tab", { name: "TestMyCode" })
      .locator("a")
    await clickUntilVisible(
      activityBarEntry,
      this.page.getByRole("heading", { name: "TestMyCode: Courses" }),
      "the TestMyCode Courses view did not open",
    )
  }

  /** A button in the Courses view's welcome content, shown while the view has no courses. */
  public coursesViewWelcomeButton(name: string): Locator {
    return this.page.locator(".welcome-view-content").getByRole("button", { name, exact: true })
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

  /** A message the extension shows in the status bar for a few seconds, matched on `text`. */
  public statusBarMessage(text: string): Locator {
    return this.page.locator('[id="workbench\\.parts\\.statusbar"]').getByText(text)
  }

  /** Runs the command titled `title` ("Category: Name") from the command palette. */
  public async runPaletteCommand(title: string): Promise<void> {
    const palette = this.page.locator(".quick-input-widget")
    // A webview that has just taken the focus may swallow the key before it forwards keys, and
    // an editor the extension opens meanwhile closes the palette; a click that lands ran it.
    await expect(async () => {
      if (!(await palette.locator("input").isVisible())) {
        await this.page.keyboard.press("F1")
      }
      await palette.locator("input").fill(`>${title}`, { timeout: 2_000 })
      await palette
        .locator(".quick-input-list .monaco-list-row")
        .filter({ hasText: title })
        .first()
        .click({ timeout: 2_000 })
    }).toPass({ timeout: 30_000 })
    await expect(palette).toBeHidden()
  }

  /**
   * Runs a command the palette lists only while the active editor is an exercise, such as
   * "TestMyCode: Reset Exercise". The palette checks that once, when it opens, so this
   * first waits for the Submit editor action, shown under the same `when` keys
   * (package.json).
   */
  public async runExercisePaletteCommand(title: string): Promise<void> {
    await expect(
      this.page
        .getByRole("toolbar", { name: "Editor actions" })
        .getByLabel("Submit", { exact: true }),
    ).toBeVisible()
    await this.runPaletteCommand(title)
  }

  public getSidePanel(): FrameLocator {
    return this.page.frameLocator(`.webview.ready`).last().frameLocator("iframe#active-frame")
  }

  /** The webview whose screen is headed `heading`, whichever editor group it is in. */
  public async panelHeaded(heading: string): Promise<FrameLocator> {
    const webviews = this.page.locator("iframe.webview.ready")
    let found: FrameLocator | undefined
    await expect(async () => {
      for (let index = (await webviews.count()) - 1; index >= 0; index--) {
        const screen = webviews.nth(index).contentFrame().frameLocator("iframe#active-frame")
        if ((await screen.getByRole("heading", { level: 1, name: heading }).count()) > 0) {
          found = screen
          return
        }
      }
      throw new Error(`No webview is headed "${heading}"`)
    }).toPass({ timeout: 30_000 })
    if (!found) {
      throw new Error(`No webview is headed "${heading}"`)
    }
    return found
  }
}
