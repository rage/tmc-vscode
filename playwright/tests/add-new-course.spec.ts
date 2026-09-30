import { expect } from "@playwright/test"

import { vsCodeTest } from "../fixtures"
import { CoursesViewPage } from "../pages/courses-view"

// Adding a course is one host-owned quick pick listing both backends. The session
// comes from the tmc credentials the fixture seeds; the extension has no TMC login
// screen any more (see fixtures.ts). These cases stay on the tmc path so they run
// against the pinned CLI, which has no mooc subcommands.

vsCodeTest("can add new course", async ({ page, webview }) => {
  const coursesView = new CoursesViewPage(page, webview)

  await vsCodeTest.step("open the Courses view", async () => {
    await coursesView.goto()
  })

  await vsCodeTest.step("add new course", async () => {
    const course = coursesView.row("Python Course")
    await expect(course).toBeHidden()
    await coursesView.addNewCourse("Python Course")
    await expect(course).toBeVisible()
  })
})

vsCodeTest("dismissing the add-course pick adds nothing", async ({ page, webview }) => {
  const coursesView = new CoursesViewPage(page, webview)
  await coursesView.goto()

  const quickPick = await coursesView.openAddCourseQuickPick()
  await quickPick.expectItem("Test Organization")
  await page.keyboard.press("Escape")

  await quickPick.expectClosed()
  await expect(coursesView.row("Python Course")).toBeHidden()
})
