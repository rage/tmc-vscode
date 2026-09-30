import { expect } from "@playwright/test"

import { vsCodeTest } from "../fixtures"
import { MoocLoginPage } from "../pages/mooc-login"
import { MyCoursesPage } from "../pages/my-courses"

// E2E of the courses.mooc.fi device-flow login, the extension's only login. The
// mock's OAuth endpoints (backend/mooc/oauth.ts) are not part of the vendored
// exercise-services spec; its default client approves five seconds after the code is issued.
//
// The fixture seeds tmc credentials, so the extension starts logged in and the
// Courses view offers no Log In; these specs reach the device flow through
// the add-course quick pick, which offers it while the (separate, absent) mooc
// credentials are missing.

vsCodeTest(
  "opens the approval page in the browser and makes the enrolled courses addable",
  async ({ page, webview, openedExternalUrls }) => {
    const myCoursesPage = new MyCoursesPage(page, webview)
    const moocLoginPage = new MoocLoginPage(page, webview)

    await vsCodeTest.step("start the login from the add-course pick", async () => {
      await myCoursesPage.goto()
      await myCoursesPage.startMoocLogin()
    })

    await vsCodeTest.step("Copy & Open opens the page that shows the code", async () => {
      await expect(moocLoginPage.codeDialog()).toBeVisible()
      await moocLoginPage.copyAndOpen()
      await expect(moocLoginPage.codeDialog()).toBeHidden()
      await expect
        .poll(openedExternalUrls)
        .toStrictEqual(["http://localhost:4001/oauth_device?user_code=WXYZ-1234"])
      await expect(moocLoginPage.waitingNotification()).toBeVisible()
    })

    await vsCodeTest.step("the mock approves and the login is confirmed", async () => {
      await expect(myCoursesPage.notificationToast("Logged in to courses.mooc.fi.")).toBeVisible()
      await expect(moocLoginPage.waitingNotification()).toBeHidden()
    })

    await vsCodeTest.step("the enrolled courses are now offered", async () => {
      const quickPick = await myCoursesPage.openAddCourseQuickPick()
      await quickPick.expectItem("MOOC Python Course")
    })
  },
)

vsCodeTest.describe(() => {
  vsCodeTest.use({ moocClientId: "mooc-mock-deny" })

  vsCodeTest("a denied login says so and offers Try again", async ({ page, webview }) => {
    const myCoursesPage = new MyCoursesPage(page, webview)
    const moocLoginPage = new MoocLoginPage(page, webview)

    await myCoursesPage.goto()
    await myCoursesPage.startMoocLogin()
    await moocLoginPage.copyAndOpen()

    const error = page
      .locator(".notification-toast")
      .filter({ hasText: "The login was denied in the browser." })
    await expect(error).toBeVisible()
    await error.getByRole("button", { name: "Try again" }).click()
    await expect(moocLoginPage.codeDialog()).toBeVisible()
  })
})

// This mock client id never approves, so the login waits until it is cancelled.
vsCodeTest.describe(() => {
  vsCodeTest.use({ moocClientId: "mooc-mock-never" })

  vsCodeTest(
    "dismissing the code cancels the login and opens nothing",
    async ({ page, webview, openedExternalUrls }) => {
      const myCoursesPage = new MyCoursesPage(page, webview)
      const moocLoginPage = new MoocLoginPage(page, webview)

      await myCoursesPage.goto()
      await myCoursesPage.startMoocLogin()
      await moocLoginPage.dismissCode()

      await expect(moocLoginPage.codeDialog()).toBeHidden()
      await expect(
        page.locator(".notification-toast").filter({ hasText: "courses.mooc.fi" }),
      ).toHaveCount(0)
      expect(await openedExternalUrls()).toStrictEqual([])
    },
  )

  // Cancel-then-retry must start a clean attempt, unaffected by the killed one ending late.
  vsCodeTest("cancel then retry starts a clean login", async ({ page, webview }) => {
    const myCoursesPage = new MyCoursesPage(page, webview)
    const moocLoginPage = new MoocLoginPage(page, webview)

    await vsCodeTest.step("cancel the pending login", async () => {
      await myCoursesPage.goto()
      await myCoursesPage.startMoocLogin()
      await moocLoginPage.copyAndOpen()
      await moocLoginPage.cancelWaiting()
      await expect(moocLoginPage.waitingNotification()).toBeHidden()
    })

    await vsCodeTest.step("retry lands on a fresh code with no error", async () => {
      await myCoursesPage.startMoocLogin()
      await expect(moocLoginPage.codeDialog()).toBeVisible()
      await moocLoginPage.dismissCode()
      await expect(page.locator(".notification-toast").filter({ hasText: "login" })).toHaveCount(0)
    })
  })
})

// The route a brand-new user takes: no credentials at all, so the Courses view's
// welcome content offers Log In. It runs the same command as the Command
// Palette's "TestMyCode: Log In".
vsCodeTest.describe(() => {
  vsCodeTest.use({ seedTmcCredentials: false })

  vsCodeTest(
    "the Courses view's Log In button starts the device flow",
    async ({ page, webview }) => {
      const moocLoginPage = new MoocLoginPage(page, webview)

      await moocLoginPage.gotoFromCoursesView()
      await expect(moocLoginPage.codeDialog()).toBeVisible()
    },
  )

  vsCodeTest("the account shows in the Accounts menu once logged in", async ({ page, webview }) => {
    const moocLoginPage = new MoocLoginPage(page, webview)

    await moocLoginPage.gotoFromCoursesView()
    await moocLoginPage.copyAndOpen()
    await expect(moocLoginPage.notificationToast("Logged in to courses.mooc.fi.")).toBeVisible()

    await page.getByRole("button", { name: "Accounts" }).click()
    await expect(page.getByRole("menuitem", { name: /courses\.mooc\.fi/ })).toBeVisible()
  })
})
