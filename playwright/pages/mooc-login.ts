import type { Locator } from "@playwright/test"

import { clickUntilVisible, TmcPage } from "./tmc"

// The user code the mock issues (backend/mooc/oauth.ts MOCK_USER_CODE).
const MOCK_USER_CODE = "WXYZ-1234"

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

  public waitingNotification(): Locator {
    return this.page
      .locator(".notification-toast")
      .filter({ hasText: "Waiting for you to approve in the browser" })
      .filter({ hasText: `Code ${MOCK_USER_CODE}` })
  }

  public async cancelWaiting(): Promise<void> {
    await this.waitingNotification().hover()
    await this.waitingNotification().getByRole("button", { name: "Cancel" }).click()
  }
}
