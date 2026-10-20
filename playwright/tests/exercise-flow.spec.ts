import { expect } from "@playwright/test"

import { vsCodeTest } from "../fixtures"
import { CourseHomePage } from "../pages/course-home"
import { CoursesViewPage } from "../pages/courses-view"
import { TmcPage } from "../pages/tmc"

// The way from a course just added to the code of its exercises, and from a passed exercise
// to the next one, without the Explorer: backend/mooc/fixtures.ts serves the courses.

vsCodeTest(
  "a course just added opens in Course Details, which downloads it and opens its workspace",
  async ({ page, webview }) => {
    const coursesView = new CoursesViewPage(page, webview)
    const courseHome = new CourseHomePage(page, webview)
    const courseTitle = "MOOC Python Course"

    await vsCodeTest.step(
      "adding the course opens it in Course Details, not a notification",
      async () => {
        await coursesView.goto()
        await coursesView.addNewMoocCourse(courseTitle)
        await courseHome.expectShown(courseTitle)
        await courseHome.expectState("passing_exercise", "Not downloaded")
        await expect(coursesView.notificationToast(`Added ${courseTitle}.`)).toBeHidden()
      },
    )

    await vsCodeTest.step(
      "Download downloads every exercise, as the Courses view agrees",
      async () => {
        await courseHome.downloadAll()
        await courseHome.expectState("passing_exercise", "Open")
        await coursesView.expand(coursesView.row(courseTitle))
        await expect(coursesView.row("passing_exercise")).toHaveAccessibleName(/, open,/)
        await expect(coursesView.notificationToast("Downloading exercises…")).toBeHidden()
      },
    )

    await vsCodeTest.step("open the course workspace from Course Details", async () => {
      await courseHome.openCourseWorkspace()
      // The window reloads into the course workspace, on the Courses view rather than the
      // Explorer, with Course Details in front.
      await expect(page).toHaveTitle(/\(mooc\) \(Workspace\)/, { timeout: 30_000 })
      await courseHome.expectShown(courseTitle)
      await expect(coursesView.row("passing_exercise")).toHaveAccessibleName(/, open,/)
      await expect(page.locator(".explorer-folders-view")).toBeHidden()
    })

    await vsCodeTest.step("the workspace's roots are its open exercises", async () => {
      await page
        .locator('[id="workbench\\.parts\\.activitybar"]')
        .getByRole("tab", { name: /^Explorer/ })
        .click()
      await expect(
        page.locator(".explorer-folders-view").getByText("passing_exercise", { exact: true }),
      ).toBeVisible()
    })
  },
)

vsCodeTest(
  "selecting an exercise opens its code, and a pass leads on to the next one",
  async ({ page, webview }) => {
    const coursesView = new CoursesViewPage(page, webview)
    const sidePanel = new TmcPage(page, webview).getSidePanel()
    const courseTitle = "MOOC Variants Course"
    const passed = coursesView.row("mixed_task_exercise")
    const next = coursesView.row("future_deadline_exercise")
    const code = page.locator(".monaco-editor").getByText("def hello()")

    await vsCodeTest.step(
      "selecting an exercise not downloaded downloads it and shows its code",
      async () => {
        await coursesView.goto()
        await coursesView.addNewMoocCourse(courseTitle)
        await coursesView.expand(coursesView.row(courseTitle))
        await expect(passed).toHaveAccessibleName(/, not downloaded,/)
        await passed.click()
        await expect(passed).toHaveAccessibleName(/, open,/)
        await expect(code).toBeVisible()
      },
    )

    await vsCodeTest.step(
      "in the course workspace, selecting it shows its code again",
      async () => {
        await coursesView.runInlineAction(coursesView.row(courseTitle), "Open Course Workspace")
        await coursesView.goto()
        await expect(code).toBeHidden()
        await coursesView.expand(coursesView.row(courseTitle))
        await passed.click()
        await expect(code).toBeVisible()
      },
    )

    await vsCodeTest.step("submit it and go on to the next exercise left to do", async () => {
      await code.click()
      await page
        .getByRole("toolbar", { name: "Editor actions" })
        .getByLabel("Submit Solution", { exact: true })
        .click()
      await expect(sidePanel.getByRole("heading", { name: "Exercise passed" })).toBeVisible()
      await expect(next).toHaveAccessibleName(/, not downloaded,/)

      // The deadline of the exercise between them has passed, so it is skipped.
      await sidePanel.getByRole("button", { name: "Next: future_deadline_exercise" }).click()

      await expect(next).toHaveAccessibleName(/, open,/)
      await expect(page.getByRole("tab", { name: /passing_exercise\.py/ }).last()).toBeVisible()
    })
  },
)
