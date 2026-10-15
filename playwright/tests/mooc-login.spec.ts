import { expect } from "@playwright/test"

import { MOCK_BACKEND_URL, mockUserCode } from "../../backend/mockSession"
import { vsCodeTest } from "../fixtures"
import { CoursesViewPage } from "../pages/courses-view"
import { MoocLoginPage } from "../pages/mooc-login"
import { QuickPickPage } from "../pages/quick-pick"

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
    const coursesView = new CoursesViewPage(page, webview)
    const moocLoginPage = new MoocLoginPage(page, webview)

    await vsCodeTest.step("start the login from the add-course pick", async () => {
      await coursesView.goto()
      await coursesView.startMoocLogin()
    })

    await vsCodeTest.step("the page carrying the code opens with no dialog first", async () => {
      await expect(moocLoginPage.waitingNotification()).toBeVisible()
      await expect
        .poll(openedExternalUrls)
        .toStrictEqual([`${MOCK_BACKEND_URL}/oauth_device?user_code=${mockUserCode(1)}`])
    })

    await vsCodeTest.step("the mock approves and the login is confirmed", async () => {
      await expect(coursesView.statusBarMessage("Logged in to courses.mooc.fi.")).toBeVisible()
      await expect(moocLoginPage.waitingNotification()).toBeHidden()
      // A modal stays until answered, so with the flow over, none was ever raised.
      await expect(moocLoginPage.modalDialog()).toHaveCount(0)
    })

    await vsCodeTest.step(
      "with no course added, the login goes on to the enrolled courses",
      async () => {
        const quickPick = new QuickPickPage(page)
        await quickPick.waitForTitle("Add New Course")
        await quickPick.expectItem("MOOC Python Course")
      },
    )
  },
)

vsCodeTest.describe(() => {
  vsCodeTest.use({ moocClientId: "mooc-mock-deny" })

  vsCodeTest("a denied login says so and offers Try again", async ({ page, webview }) => {
    const coursesView = new CoursesViewPage(page, webview)
    const moocLoginPage = new MoocLoginPage(page, webview)

    await coursesView.goto()
    await coursesView.startMoocLogin()

    const error = page
      .locator(".notification-toast")
      .filter({ hasText: "The login was denied in the browser." })
    await expect(error).toBeVisible()
    await error.getByRole("button", { name: "Try again" }).click()
    await expect(moocLoginPage.waitingNotification(2)).toBeVisible()
  })
})

vsCodeTest.describe(() => {
  vsCodeTest.use({ moocClientId: "mooc-mock-unavailable" })

  vsCodeTest(
    "a server error says the server failed, not the connection",
    async ({ page, webview }) => {
      const coursesView = new CoursesViewPage(page, webview)

      await coursesView.goto()
      await coursesView.startMoocLogin()

      await expect(
        coursesView.notificationToast("courses.mooc.fi returned an error (503). Try again later."),
      ).toBeVisible()
      await expect(coursesView.notificationToast("Check your internet connection")).toHaveCount(0)
    },
  )
})

// This mock client id never approves, so the login waits until it is cancelled.
vsCodeTest.describe(() => {
  vsCodeTest.use({ moocClientId: "mooc-mock-never" })

  // Cancel-then-retry must start a clean attempt, unaffected by the killed one ending late.
  vsCodeTest("cancel then retry starts a clean login", async ({ page, webview }) => {
    const coursesView = new CoursesViewPage(page, webview)
    const moocLoginPage = new MoocLoginPage(page, webview)

    await coursesView.goto()
    await coursesView.startMoocLogin()
    await expect(moocLoginPage.waitingNotification(1)).toBeVisible()
    const shownToasts = await moocLoginPage.recordToasts()

    await vsCodeTest.step("cancel the pending login", async () => {
      await moocLoginPage.cancelWaiting(1)
      await expect(moocLoginPage.waitingNotification(1)).toBeHidden()
    })

    await vsCodeTest.step("retry lands on a fresh code with no error", async () => {
      await coursesView.startMoocLogin()
      await expect(moocLoginPage.waitingNotification(2)).toBeVisible()
      // By now the killed attempt has long ended, so any toast it caused was shown.
      const errors = (await shownToasts()).filter(
        (text) => !text.includes("Waiting for you to approve") && /login|failed/i.test(text),
      )
      expect(errors).toStrictEqual([])
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
      await expect(moocLoginPage.waitingNotification()).toBeVisible()
    },
  )

  vsCodeTest("the account shows in the Accounts menu once logged in", async ({ page, webview }) => {
    const moocLoginPage = new MoocLoginPage(page, webview)

    await moocLoginPage.gotoFromCoursesView()
    await expect(moocLoginPage.statusBarMessage("Logged in to courses.mooc.fi.")).toBeVisible()
    await page.keyboard.press("Escape")

    await page.getByRole("button", { name: "Accounts" }).click()
    await expect(page.getByRole("menuitem", { name: /courses\.mooc\.fi/ })).toBeVisible()
  })
})
