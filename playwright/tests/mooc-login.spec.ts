import { expect } from "@playwright/test"

import { vsCodeTest } from "../fixtures"
import { LoginPage } from "../pages/login"
import { MoocLoginPage } from "../pages/mooc-login"
import { SelectPlatform } from "../pages/select-platform"

// E2E of the courses.mooc.fi device-flow login. The mock's OAuth endpoints
// (backend/mooc/oauth.ts) are not part of the vendored exercise-services spec.
//
// tmc login is a separate, unaffected credential state; the student logs in to
// tmc first because adding any course requires it, then does the mooc login.

vsCodeTest("shows the device code and lands in the mooc course flow", async ({ page, webview }) => {
  const loginPage = new LoginPage(page, webview)
  const selectPlatform = new SelectPlatform(page, webview)
  const moocLoginPage = new MoocLoginPage(page, webview)

  await vsCodeTest.step("log in to tmc", async () => {
    await loginPage.goto()
    await loginPage.login("student")
  })

  await vsCodeTest.step("pick the mooc platform", async () => {
    await webview.getByRole("button", { name: "Add new course" }).first().click()
    await selectPlatform.selectMooc()
  })

  await vsCodeTest.step("the device code is shown", async () => {
    await expect(moocLoginPage.heading()).toBeVisible()
    await expect(moocLoginPage.userCode()).toBeVisible()
  })

  await vsCodeTest.step("the mock approves and the flow continues", async () => {
    await expect(
      moocLoginPage.getSidePanel().getByRole("heading", { name: "Enrolled courses" }),
    ).toBeVisible()
    await expect(
      moocLoginPage.getSidePanel().getByRole("heading", { name: "MOOC Python Course" }).first(),
    ).toBeVisible()
  })
})

// This mock client id never approves, so the login stays on the waiting screen
// until it is cancelled.
vsCodeTest.describe(() => {
  vsCodeTest.use({ moocClientId: "mooc-mock-never" })

  vsCodeTest("can cancel a pending device login", async ({ page, webview }) => {
    const loginPage = new LoginPage(page, webview)
    const selectPlatform = new SelectPlatform(page, webview)
    const moocLoginPage = new MoocLoginPage(page, webview)

    await vsCodeTest.step("log in to tmc", async () => {
      await loginPage.goto()
      await loginPage.login("student")
    })

    await vsCodeTest.step("pick the mooc platform", async () => {
      await webview.getByRole("button", { name: "Add new course" }).first().click()
      await selectPlatform.selectMooc()
    })

    await vsCodeTest.step("cancel the pending login", async () => {
      await expect(moocLoginPage.heading()).toBeVisible()
      await expect(moocLoginPage.userCode()).toBeVisible()
      await moocLoginPage.cancel()
      await expect(moocLoginPage.getSidePanel().getByText("Login cancelled.")).toBeVisible()
      await expect(
        moocLoginPage.getSidePanel().getByRole("button", { name: "Try again" }),
      ).toBeVisible()
    })
  })

  // Regression for orphaned/concurrent logins: cancel-then-retry must start a
  // clean attempt, unaffected by the old (killed) invocation resolving late.
  vsCodeTest(
    "cancel then retry starts a clean login with no error flash",
    async ({ page, webview }) => {
      const loginPage = new LoginPage(page, webview)
      const selectPlatform = new SelectPlatform(page, webview)
      const moocLoginPage = new MoocLoginPage(page, webview)

      await vsCodeTest.step("log in to tmc and pick the mooc platform", async () => {
        await loginPage.goto()
        await loginPage.login("student")
        await webview.getByRole("button", { name: "Add new course" }).first().click()
        await selectPlatform.selectMooc()
      })

      await vsCodeTest.step("cancel the pending login", async () => {
        await expect(moocLoginPage.userCode()).toBeVisible()
        await moocLoginPage.cancel()
        await expect(moocLoginPage.getSidePanel().getByText("Login cancelled.")).toBeVisible()
      })

      await vsCodeTest.step("retry lands on a fresh device code with no error", async () => {
        await moocLoginPage.tryAgain()
        // Proves a new process is live, not the killed one.
        await expect(moocLoginPage.userCode()).toBeVisible()
        // The late-resolving cancelled attempt must not surface an error banner.
        await expect(moocLoginPage.errorBanner()).toHaveCount(0)
      })

      await vsCodeTest.step("the retried login cancels cleanly", async () => {
        // Also leaves no orphaned `mooc login` process running into teardown.
        await moocLoginPage.cancel()
        await expect(moocLoginPage.getSidePanel().getByText("Login cancelled.")).toBeVisible()
      })
    },
  )
})
