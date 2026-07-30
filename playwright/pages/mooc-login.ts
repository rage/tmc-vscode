import { TmcPage } from "./tmc"

// The courses.mooc.fi device-flow login screen, shown when no mooc credentials
// are stored.
export class MoocLoginPage extends TmcPage {
  // Only reachable with no credentials at all: the entry is hidden once the
  // extension considers the user logged in.
  public async gotoFromTreeView(): Promise<void> {
    await this.openMenu()
    const loginLocator = this.page.getByRole("treeitem", { name: "Log in" }).locator("a")
    await loginLocator.waitFor()
    // the menu can be visible before it has fully loaded, and clicking it then errors
    // oxlint-disable-next-line playwright/no-wait-for-timeout -- deliberate settle-delay while polling flaky VS Code webview UI
    await this.page.waitForTimeout(100)
    await loginLocator.click()
  }

  public heading() {
    return this.getSidePanel().getByRole("heading", { name: "Log in to courses.mooc.fi" })
  }

  // The user code the mock issues (backend/mooc/oauth.ts MOCK_USER_CODE).
  public userCode() {
    return this.getSidePanel().getByText("WXYZ-1234")
  }

  public async cancel(): Promise<void> {
    await this.getSidePanel().getByRole("button", { name: "Cancel" }).click()
  }

  public async tryAgain(): Promise<void> {
    await this.getSidePanel().getByRole("button", { name: "Try again" }).click()
  }

  // Matched by "Login failed" text; the bare "alert" role also matches the
  // waiting progress ring, so it isn't specific enough.
  public errorBanner() {
    return this.getSidePanel().getByText("Login failed")
  }
}
