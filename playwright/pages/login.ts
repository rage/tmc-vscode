import { TmcPage } from "./tmc"

export class LoginPage extends TmcPage {
  public async goto(): Promise<void> {
    await this.openMenu()
    const loginLocator = this.page.getByRole("treeitem", { name: "Log in" }).locator("a")
    await loginLocator.waitFor()
    // sometimes the menu is visible before it has fully loaded and
    // clicking it causes an error
    // oxlint-disable-next-line playwright/no-wait-for-timeout -- deliberate settle-delay while polling flaky VS Code webview UI
    await this.page.waitForTimeout(100)
    await loginLocator.click()
  }

  public async login(username: string, password?: string): Promise<void> {
    await this.webview.getByRole("textbox", { name: "Email or username:" }).fill(username)
    await this.webview
      .getByRole("textbox", { name: "Password:" })
      .first()
      .fill(password ?? username)
    await this.webview.getByRole("button", { name: "Log in" }).first().click()
  }
}
