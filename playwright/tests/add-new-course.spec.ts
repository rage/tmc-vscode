import { expect } from "@playwright/test"

import { vsCodeTest } from "../fixtures"
import { MyCoursesPage } from "../pages/my-courses"

// Adding a course is one host-owned quick pick listing both backends. The session
// comes from the tmc credentials the fixture seeds; the extension has no TMC login
// screen any more (see fixtures.ts). These cases stay on the tmc path so they run
// against the pinned CLI, which has no mooc subcommands.

vsCodeTest("can add new course", async ({ page, webview }) => {
  const myCoursesPage = new MyCoursesPage(page, webview)

  await vsCodeTest.step("open My Courses", async () => {
    await myCoursesPage.goto()
  })

  await vsCodeTest.step("add new course", async () => {
    const newCourseHeader = webview.getByRole("heading", {
      name: "Python Course (python-course)",
    })
    await expect(newCourseHeader).toBeHidden()
    await myCoursesPage.addNewCourse("Python Course")
    await expect(newCourseHeader).toBeVisible()
  })
})

vsCodeTest("dismissing the add-course pick adds nothing", async ({ page, webview }) => {
  const myCoursesPage = new MyCoursesPage(page, webview)
  await myCoursesPage.goto()

  const quickPick = await myCoursesPage.openAddCourseQuickPick()
  await quickPick.expectItem("Test Organization")
  await page.keyboard.press("Escape")

  await quickPick.expectClosed()
  await expect(webview.getByRole("heading", { name: "Python Course (python-course)" })).toBeHidden()
})
