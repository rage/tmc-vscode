import { expect } from "@playwright/test"

import { vsCodeTest } from "../fixtures"
import { MyCoursesPage } from "../pages/my-courses"

// The session comes from the tmc credentials the fixture seeds; the extension has
// no TMC login screen any more (see fixtures.ts).
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
