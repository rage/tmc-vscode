import * as fs from "fs"
import { join } from "path"

import { expect } from "@playwright/test"

import { vsCodeTest } from "../fixtures"
import { MoocLoginPage } from "../pages/mooc-login"

/** The folder activation downloads the CLI to, which a light start never touches. */
function cliFolder(userDataDir: string): string {
  return join(userDataDir, "User", "globalStorage", "moocfi.test-my-code", "cli")
}

// No stored login and no course: the window TestMyCode starts light in.
vsCodeTest.use({ seedTmcCredentials: false })

vsCodeTest(
  "a fresh install opens the walkthrough without starting the CLI",
  async ({ page, userDataDir }) => {
    await expect(page.getByText("Get Started with TestMyCode").first()).toBeVisible()
    // oxlint-disable-next-line playwright/no-wait-for-timeout -- only a wait shows the CLI never comes; a full activation downloads it within this
    await page.waitForTimeout(3000)

    expect(fs.existsSync(cliFolder(userDataDir))).toBe(false)
  },
)

vsCodeTest("opening the Courses view starts TestMyCode", async ({ page, webview, userDataDir }) => {
  const moocLoginPage = new MoocLoginPage(page, webview)

  await moocLoginPage.openMenu()

  await expect(moocLoginPage.coursesViewWelcomeButton("Log In")).toBeVisible()
  expect(fs.existsSync(cliFolder(userDataDir))).toBe(true)
  await expect(
    page.locator('[id="workbench.parts.statusbar"]').getByRole("button", { name: /not logged in/ }),
  ).toBeVisible()
})

vsCodeTest(
  "the walkthrough's Log In starts TestMyCode and the login",
  async ({ page, webview }) => {
    const moocLoginPage = new MoocLoginPage(page, webview)

    await page
      .locator(".getting-started-step")
      .filter({ hasText: "Log in" })
      .first()
      .getByRole("button", { name: "Log In" })
      .click()

    await expect(moocLoginPage.waitingNotification()).toBeVisible()
  },
)
