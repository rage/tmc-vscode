import { expect } from "@playwright/test"

import { vsCodeTest } from "../fixtures"
import { MoocLoginPage } from "../pages/mooc-login"

// Every test starts from an empty profile, which activation treats as a fresh install.
vsCodeTest(
  "a fresh install opens the walkthrough, not the Welcome page",
  async ({ page, webview }) => {
    const tmcPage = new MoocLoginPage(page, webview)

    await tmcPage.openMenu()

    await expect(page.getByText("Get Started with TestMyCode").first()).toBeVisible()
    await expect(page.getByRole("tab", { name: /Welcome to TestMyCode/ })).toHaveCount(0)
  },
)
