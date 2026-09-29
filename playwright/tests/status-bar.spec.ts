import { expect } from "@playwright/test"
import type { Page } from "@playwright/test"

import { vsCodeTest } from "../fixtures"
import { MoocLoginPage } from "../pages/mooc-login"

function statusBarItem(page: Page, name: RegExp) {
  return page.locator('[id="workbench.parts.statusbar"]').getByRole("button", { name })
}

vsCodeTest("the account item shows the logged-in session", async ({ page, webview }) => {
  await new MoocLoginPage(page, webview).openMenu()

  await expect(statusBarItem(page, /logged in with courses\.mooc\.fi/)).toBeVisible()
})

vsCodeTest.describe(() => {
  vsCodeTest.use({ seedTmcCredentials: false })

  vsCodeTest("the logged-out account item starts the device flow", async ({ page, webview }) => {
    const moocLoginPage = new MoocLoginPage(page, webview)
    await moocLoginPage.openMenu()

    await statusBarItem(page, /not logged in/).click()

    await expect(moocLoginPage.heading()).toBeVisible()
  })
})
