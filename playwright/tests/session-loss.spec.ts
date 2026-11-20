import { expect } from "@playwright/test"

import { MOCK_BACKEND_URL } from "../../backend/mockSession"
import { vsCodeTest } from "../fixtures"
import { CourseHomePage } from "../pages/course-home"
import { CoursesViewPage } from "../pages/courses-view"
import { MoocLoginPage } from "../pages/mooc-login"

vsCodeTest.use({ isCoursesMoocFiEnabled: true })

// A session lost while a screen is on view is told there once, with one Log In, and in the
// status bar, never by notification. backend/mooc revokes the grant on request.

const COURSE_TITLE = "MOOC Python Course"

vsCodeTest(
  "a session lost in Course Details shows one Log In there and no notification",
  async ({ page, webview }) => {
    const coursesView = new CoursesViewPage(page, webview)
    const courseHome = new CourseHomePage(page, webview)
    const login = new MoocLoginPage(page, webview)

    await coursesView.goto()
    await coursesView.addNewMoocCourse(COURSE_TITLE)
    await courseHome.expectShown(COURSE_TITLE)
    const toasts = await login.recordToasts()

    const revoked = await fetch(`${MOCK_BACKEND_URL}/mooc-mock/revoke-grant`, { method: "POST" })
    expect(revoked.status).toBe(204)
    await courseHome.refresh()

    await expect(courseHome.notices().getByText("Logged out", { exact: true })).toBeVisible({
      timeout: 30_000,
    })
    await expect(courseHome.webview.getByRole("button", { name: "Log In" })).toHaveCount(1)
    await expect(courseHome.webview.getByRole("alert")).toHaveCount(0)
    await expect(coursesView.statusBarMessage("Logged Out")).toBeVisible()
    expect((await toasts()).filter((text) => /logged out/i.test(text))).toStrictEqual([])
  },
)
