import type { Locator } from "@playwright/test"

import { clickUntilVisible, TmcPage } from "./tmc"

// The user code the mock issues (backend/mooc/oauth.ts MOCK_USER_CODE).
const MOCK_USER_CODE = "WXYZ-1234"

/** The courses.mooc.fi device-flow login: a modal with the code, then a progress notification. */
export class MoocLoginPage extends TmcPage {
  // Only reachable with no credentials at all: the Courses view shows this welcome
  // content only while the extension considers the user logged out.
  public async gotoFromCoursesView(): Promise<void> {
    await this.openMenu()
    await clickUntilVisible(
      this.coursesViewWelcomeButton("Log In"),
      this.codeDialog(),
      "the login code dialog did not open",
    )
  }

  /** The modal showing the code; `window.dialogStyle: custom` renders it inside the page. */
  public codeDialog(): Locator {
    return this.page
      .getByRole("dialog")
      .filter({ hasText: `Your courses.mooc.fi login code is ${MOCK_USER_CODE}` })
  }

  public async copyAndOpen(): Promise<void> {
    await this.codeDialog().getByRole("button", { name: "Copy & Open courses.mooc.fi" }).click()
  }

  public async dismissCode(): Promise<void> {
    await this.codeDialog().getByRole("button", { name: "Cancel" }).click()
  }

  public waitingNotification(): Locator {
    return this.page
      .locator(".notification-toast")
      .filter({ hasText: "Waiting for you to approve in the browser" })
  }

  public async cancelWaiting(): Promise<void> {
    await this.waitingNotification().hover()
    await this.waitingNotification().getByRole("button", { name: "Cancel" }).click()
  }
}
