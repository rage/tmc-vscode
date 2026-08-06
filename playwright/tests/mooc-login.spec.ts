import { expect } from "@playwright/test"

import { vsCodeTest } from "../fixtures"
import { migrationTest } from "../migration-gate"
import { MoocLoginPage } from "../pages/mooc-login"
import { MyCoursesPage } from "../pages/my-courses"
import { SelectPlatform } from "../pages/select-platform"

// E2E of the courses.mooc.fi device-flow login, the extension's only login. The
// mock's OAuth endpoints (backend/mooc/oauth.ts) are not part of the vendored
// exercise-services spec.
//
// The fixture seeds tmc credentials, so the extension starts logged in and the
// tree view's "Log in" entry is hidden; these specs reach the device flow through
// the mooc course flow, which checks the (separate, absent) mooc credentials.

migrationTest(
  "shows the device code and lands in the mooc course flow",
  async ({ page, webview }) => {
    const myCoursesPage = new MyCoursesPage(page, webview)
    const selectPlatform = new SelectPlatform(page, webview)
    const moocLoginPage = new MoocLoginPage(page, webview)

    await vsCodeTest.step("pick the mooc platform", async () => {
      await myCoursesPage.goto()
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
  },
)

// This mock client id never approves, so the login stays on the waiting screen
// until it is cancelled.
vsCodeTest.describe(() => {
  vsCodeTest.use({ moocClientId: "mooc-mock-never" })

  migrationTest("can cancel a pending device login", async ({ page, webview }) => {
    const myCoursesPage = new MyCoursesPage(page, webview)
    const selectPlatform = new SelectPlatform(page, webview)
    const moocLoginPage = new MoocLoginPage(page, webview)

    await vsCodeTest.step("pick the mooc platform", async () => {
      await myCoursesPage.goto()
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
  migrationTest(
    "cancel then retry starts a clean login with no error flash",
    async ({ page, webview }) => {
      const myCoursesPage = new MyCoursesPage(page, webview)
      const selectPlatform = new SelectPlatform(page, webview)
      const moocLoginPage = new MoocLoginPage(page, webview)

      await vsCodeTest.step("pick the mooc platform", async () => {
        await myCoursesPage.goto()
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

// The route a brand-new user takes: no credentials at all, so the tree view's
// "Log in" entry is the only way in. It runs the same command as the Command
// Palette's "TestMyCode: Log In".
vsCodeTest.describe(() => {
  vsCodeTest.use({ seedTmcCredentials: false })

  migrationTest(
    "the tree view's Log in entry starts the device flow",
    async ({ page, webview }) => {
      const moocLoginPage = new MoocLoginPage(page, webview)

      await moocLoginPage.gotoFromTreeView()
      await expect(moocLoginPage.heading()).toBeVisible()
      await expect(moocLoginPage.userCode()).toBeVisible()
    },
  )
})
