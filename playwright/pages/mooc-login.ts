import type { Locator } from "@playwright/test"

import { mockUserCode } from "../../backend/mockSession"
import { clickUntilVisible, expectVisibleInWebview, TmcPage } from "./tmc"

/**
 * The courses.mooc.fi device-flow login screen in the main panel
 * (webview-ui/src/panels/Login.svelte).
 */
export class MoocLoginPage extends TmcPage {
  // Only reachable with no credentials at all: the Courses view shows this welcome
  // content only while the extension considers the user logged out.
  public async gotoFromCoursesView(): Promise<void> {
    await this.openMenu()
    await clickUntilVisible(
      this.coursesViewWelcomeButton("Log In"),
      this.heading(),
      "the login screen did not open",
    )
  }

  public heading(): Locator {
    return this.webview.getByRole("heading", { level: 1, name: "Log in to courses.mooc.fi" })
  }

  /** The code of the `attempt`th login since the test started, as the screen shows it. */
  public code(attempt = 1): Locator {
    return this.webview.getByText(mockUserCode(attempt), { exact: true })
  }

  /** The failure the screen heads with `title`, e.g. "Login denied". */
  public failure(title: string): Locator {
    return this.webview.getByRole("heading", { level: 2, name: title })
  }

  public button(name: string): Locator {
    return this.webview.getByRole("button", { name, exact: true })
  }

  public async expectWaiting(attempt = 1): Promise<void> {
    await expectVisibleInWebview(this.code(attempt))
  }

  /** Any modal dialog; `window.dialogStyle: custom` renders one inside the page. */
  public modalDialog(): Locator {
    // Not `getByRole("dialog")`: every notification toast has that role too.
    return this.page.locator(".monaco-dialog-box")
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
