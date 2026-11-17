import { expect } from "@playwright/test"

import { MOCK_BACKEND_URL, mockUserCode } from "../../backend/mockSession"
import { vsCodeTest } from "../fixtures"
import { AddCoursePage } from "../pages/add-course"
import { CoursesViewPage } from "../pages/courses-view"
import { MoocLoginPage } from "../pages/mooc-login"

// E2E of the courses.mooc.fi device-flow login screen, the extension's only login. The
// mock's OAuth endpoints (backend/mooc/oauth.ts) are not part of the vendored
// exercise-services spec; its default client approves five seconds after the code is issued.
//
// The fixture seeds tmc credentials, so the extension starts logged in and the
// Courses view offers no Log In; these specs reach the device flow through
// the add-course screen, which offers it while the (separate, absent) mooc
// credentials are missing.

vsCodeTest(
  "an approved login goes back to the add-course screen, listing the enrolled courses",
  async ({ page, webview }) => {
    const coursesView = new CoursesViewPage(page, webview)
    const loginScreen = new MoocLoginPage(page, webview)

    await coursesView.goto()
    await coursesView.startMoocLogin()

    await expect(coursesView.statusBarMessage("Logged in.")).toBeVisible()
    const addCourse = new AddCoursePage(page, webview)
    await addCourse.expectShown()
    await expect(addCourse.card("MOOC Python Course")).toBeVisible()
    // A modal stays until answered, so with the flow over, none was ever raised.
    await expect(loginScreen.modalDialog()).toHaveCount(0)
  },
)

vsCodeTest.describe(() => {
  vsCodeTest.use({ moocClientId: "mooc-mock-deny" })

  vsCodeTest("a denied login says so and offers Try Again", async ({ page, webview }) => {
    const coursesView = new CoursesViewPage(page, webview)
    const loginScreen = new MoocLoginPage(page, webview)

    await coursesView.goto()
    await coursesView.startMoocLogin()

    await expect(loginScreen.failure("Login denied")).toBeVisible({ timeout: 30_000 })
    await expect(coursesView.notificationToast("denied")).toHaveCount(0)
    await loginScreen.button("Try Again").click()
    await loginScreen.expectWaiting(2)
  })
})

vsCodeTest.describe(() => {
  vsCodeTest.use({ moocClientId: "mooc-mock-expired" })

  vsCodeTest("an expired code says so and offers Try Again", async ({ page, webview }) => {
    const coursesView = new CoursesViewPage(page, webview)
    const loginScreen = new MoocLoginPage(page, webview)

    await coursesView.goto()
    await coursesView.startMoocLogin()

    await expect(loginScreen.failure("Login code expired")).toBeVisible({ timeout: 30_000 })
    await expect(loginScreen.button("Try Again")).toBeVisible()
  })
})

vsCodeTest.describe(() => {
  vsCodeTest.use({ moocClientId: "mooc-mock-unavailable" })

  vsCodeTest(
    "a server error says the server failed, not the connection",
    async ({ page, webview }) => {
      const coursesView = new CoursesViewPage(page, webview)
      const loginScreen = new MoocLoginPage(page, webview)

      await coursesView.goto()
      await coursesView.startMoocLogin()

      await expect(loginScreen.failure("The server ran into a problem")).toBeVisible({
        timeout: 30_000,
      })
      await expect(
        loginScreen.webview.getByText("The server ran into a problem. Try again later."),
      ).toBeVisible()
      await expect(loginScreen.webview.getByText("Check your internet connection")).toHaveCount(0)
      await expect(loginScreen.button("Show Details")).toBeVisible()
    },
  )
})

// This mock client id never approves, so the login waits until it is cancelled.
vsCodeTest.describe(() => {
  vsCodeTest.use({ moocClientId: "mooc-mock-never" })

  vsCodeTest(
    "shows the code and opens the approval page only on request",
    async ({ page, webview, openedExternalUrls }) => {
      const coursesView = new CoursesViewPage(page, webview)
      const loginScreen = new MoocLoginPage(page, webview)

      await coursesView.goto()
      await coursesView.startMoocLogin()

      await loginScreen.expectWaiting()
      await expect(loginScreen.webview.getByText(`${MOCK_BACKEND_URL}/oauth_device`)).toBeVisible()
      expect(await openedExternalUrls()).toStrictEqual([])
      await loginScreen.button("Open MOOC.fi").click()
      await expect
        .poll(openedExternalUrls)
        .toStrictEqual([`${MOCK_BACKEND_URL}/oauth_device?user_code=${mockUserCode(1)}`])
    },
  )

  // Cancel-then-retry must start a clean attempt, unaffected by the killed one ending late.
  vsCodeTest(
    "Cancel closes the screen, and a retry starts a clean login",
    async ({ page, webview }) => {
      const coursesView = new CoursesViewPage(page, webview)
      const loginScreen = new MoocLoginPage(page, webview)

      await coursesView.goto()
      await coursesView.startMoocLogin()
      await loginScreen.expectWaiting(1)
      const shownToasts = await loginScreen.recordToasts()

      await vsCodeTest.step("cancel the pending login", async () => {
        await loginScreen.button("Cancel").click()
        await expect(page.getByRole("tab", { name: /^Log In/ })).toHaveCount(0)
      })

      await vsCodeTest.step("retry lands on a fresh code with no error", async () => {
        await coursesView.startMoocLogin()
        await loginScreen.expectWaiting(2)
        // By now the killed attempt has long ended, so any toast it caused was shown.
        const errors = (await shownToasts()).filter((text) => /login|failed/i.test(text))
        expect(errors).toStrictEqual([])
        await expect(loginScreen.failure("Login failed")).toHaveCount(0)
      })

      await vsCodeTest.step("closing the screen's tab cancels the login too", async () => {
        const tab = page.getByRole("tab", { name: /^Log In/ })
        await tab.hover()
        await tab.getByRole("button", { name: /^Close/ }).click()
        await expect(tab).toHaveCount(0)
        await coursesView.startMoocLogin()
        await loginScreen.expectWaiting(3)
      })
    },
  )
})

// The route a brand-new user takes: no credentials at all, so the Courses view's
// welcome content offers Log In. It runs the same command as the Command
// Palette's "TestMyCode: Log In".
vsCodeTest.describe(() => {
  vsCodeTest.use({ seedTmcCredentials: false })

  vsCodeTest(
    "the Courses view's Log In opens the login screen, which goes on to adding a course",
    async ({ page, webview }) => {
      const loginScreen = new MoocLoginPage(page, webview)

      await loginScreen.gotoFromCoursesView()
      await expect(loginScreen.statusBarMessage("Logged in.")).toBeVisible()
      await new AddCoursePage(page, webview).expectShown()
    },
  )

  vsCodeTest("the account shows in the Accounts menu once logged in", async ({ page, webview }) => {
    const loginScreen = new MoocLoginPage(page, webview)

    await loginScreen.gotoFromCoursesView()
    await expect(loginScreen.statusBarMessage("Logged in.")).toBeVisible()

    await page.getByRole("button", { name: "Accounts" }).click()
    await expect(page.getByRole("menuitem", { name: /courses\.mooc\.fi/ })).toBeVisible()
  })
})
