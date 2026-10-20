import { expect } from "@playwright/test"

import { vsCodeTest } from "../fixtures"
import { TmcPage } from "../pages/tmc"

// Every test starts from an empty profile, which activation treats as a fresh install.
vsCodeTest("a fresh install opens the walkthrough", async ({ page, webview }) => {
  const tmcPage = new TmcPage(page, webview)

  await tmcPage.openMenu()

  await expect(page.getByText("Get Started with TestMyCode").first()).toBeVisible()
})

// The fixture's stored session exists before VS Code first shows the walkthrough.
vsCodeTest("a session from before the walkthrough ticks off Log in", async ({ page, webview }) => {
  await new TmcPage(page, webview).openMenu()

  const logIn = page.locator(".getting-started-step").filter({ hasText: "Log in" }).first()
  await expect(logIn.locator(".codicon-getting-started-step-checked")).toBeVisible()
})
