import type { Locator } from "@playwright/test"

import { mockUserCode } from "../../backend/mockSession"
import { clickUntilVisible, TmcPage } from "./tmc"

/** The courses.mooc.fi device-flow login: a progress notification showing the code. */
export class MoocLoginPage extends TmcPage {
  // Only reachable with no credentials at all: the Courses view shows this welcome
  // content only while the extension considers the user logged out.
  public async gotoFromCoursesView(): Promise<void> {
    await this.openMenu()
    await clickUntilVisible(
      this.coursesViewWelcomeButton("Log In"),
      this.waitingNotification(),
      "the login did not start",
    )
  }

  /** Any modal dialog; `window.dialogStyle: custom` renders one inside the page. */
  public modalDialog(): Locator {
    // Not `getByRole("dialog")`: every notification toast has that role too.
    return this.page.locator(".monaco-dialog-box")
  }

  /** The progress notification of the `attempt`th login since the test started. */
  public waitingNotification(attempt = 1): Locator {
    return this.page
      .locator(".notification-toast")
      .filter({ hasText: "Waiting for you to approve in the browser" })
      .filter({ hasText: `Code ${mockUserCode(attempt)}` })
  }

  public async cancelWaiting(attempt = 1): Promise<void> {
    await this.waitingNotification(attempt).hover()
    await this.waitingNotification(attempt).getByRole("button", { name: "Cancel" }).click()
  }

  /**
   * Starts recording every notification toast shown from now on, and returns a
   * reader for their texts. A toast that has already been dismissed again still
   * counts, which a locator assertion would miss.
   */
  public async recordToasts(): Promise<() => Promise<string[]>> {
    await this.page.evaluate(() => {
      // Elements, not texts: a toast is filled in after it is attached, and a
      // detached one keeps its content.
      const shown: Element[] = []
      Object.assign(globalThis, { tmcShownToasts: shown })
      new MutationObserver((mutations) => {
        for (const node of mutations.flatMap((mutation) => [...mutation.addedNodes])) {
          if (node instanceof Element) {
            shown.push(
              ...(node.matches(".notification-toast")
                ? [node]
                : node.querySelectorAll(".notification-toast")),
            )
          }
        }
      }).observe(document.body, { childList: true, subtree: true })
    })
    return () =>
      this.page.evaluate(() =>
        ((globalThis as { tmcShownToasts?: Element[] }).tmcShownToasts ?? []).map(
          (toast) => toast.textContent ?? "",
        ),
      )
  }
}
