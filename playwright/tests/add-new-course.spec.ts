import { expect } from "@playwright/test"

import { vsCodeTest } from "../fixtures"
import { CourseHomePage } from "../pages/course-home"
import { CoursesViewPage } from "../pages/courses-view"

// Adding a course is one host-owned quick pick listing both backends; these cases pick
// from the tmc side. The session comes from the tmc credentials the fixture seeds
// (fixtures.ts).

vsCodeTest("can add new course", async ({ page, webview }) => {
  const coursesView = new CoursesViewPage(page, webview)
  const courseHome = new CourseHomePage(page, webview)

  await vsCodeTest.step("open the Courses view", async () => {
    await coursesView.goto()
  })

  await vsCodeTest.step("add new course", async () => {
    const course = coursesView.row("Python Course")
    await expect(course).toBeHidden()
    await coursesView.addNewCourse("Python Course")
    await expect(course).toBeVisible()
  })

  await vsCodeTest.step("its Course Details lists its part and exercises", async () => {
    await courseHome.expectShown("Python Course")
    await expect(courseHome.webview.getByRole("button", { name: "Part 1" })).toBeVisible()
    await courseHome.expectState("01_passing_exercise", "Not downloaded")
    await expect(courseHome.row("01_passing_exercise")).toContainText("0/1")
  })

  await vsCodeTest.step(
    "opening an exercise from its row downloads it and shows its code",
    async () => {
      await courseHome.openExercise("01_passing_exercise")
      await expect(page.getByRole("tab", { name: /passing_exercise\.py/ })).toBeVisible()
      await courseHome.reveal("Python Course")
      await courseHome.expectState("01_passing_exercise", "Open")
      await expect(courseHome.row("02_failing_exercise")).toContainText("Not downloaded")
    },
  )
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
