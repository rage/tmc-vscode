import { expect } from "@playwright/test"

import { vsCodeTest } from "../fixtures"
import { TmcPage } from "../pages/tmc"

// Every test starts from an empty profile, which activation treats as a fresh install.
vsCodeTest("a fresh install opens the walkthrough", async ({ page, webview }) => {
  const tmcPage = new TmcPage(page, webview)

  await tmcPage.openMenu()

  await expect(page.getByText("Get Started with TestMyCode").first()).toBeVisible()
})
