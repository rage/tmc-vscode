import { expect } from "@playwright/test"
import type { Locator } from "@playwright/test"

import { vsCodeTest } from "../fixtures"
import { CourseHomePage } from "../pages/course-home"
import { CoursesViewPage } from "../pages/courses-view"
import { ExplorerPage } from "../pages/explorer"
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
        await courseHome.expectState("passing_exercise", "Downloaded")
        await coursesView.expand(coursesView.row(courseTitle))
        await expect(coursesView.row("passing_exercise")).toHaveAccessibleName(/, downloaded,/)
        await expect(coursesView.notificationToast("Downloading exercises…")).toBeHidden()
      },
    )

    await vsCodeTest.step("open the course workspace from Course Details", async () => {
      await courseHome.openCourseWorkspace()
      // The window reloads into the course workspace, on the Courses view rather than the
      // Explorer, with Course Details in front.
      await expect(page).toHaveTitle(/\(mooc\) \(Workspace\)/, { timeout: 30_000 })
      await courseHome.expectShown(courseTitle)
      await expect(coursesView.row("passing_exercise")).toHaveAccessibleName(/, in workspace,/)
      await expect(page.locator(".explorer-folders-view")).toBeHidden()
    })

    await vsCodeTest.step(
      "in its workspace, Course Details continues with the exercise left to do",
      async () => {
        await courseHome.webview.getByRole("button", { name: "Continue: passing_exercise" }).click()
        await expect(page.getByRole("tab", { name: /passing_exercise\.py/ })).toBeVisible()
      },
    )

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
    const explorer = new ExplorerPage(page)
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
        await expect(passed).toHaveAccessibleName(/, (downloaded|in workspace),/)
        await expect(code).toBeVisible()
      },
    )

    await vsCodeTest.step(
      "in the course workspace, selecting it shows its code again",
      async () => {
        await coursesView.runInlineAction(coursesView.row(courseTitle), "Open Course Workspace")
        // Clicks sent to the window that is reloading are lost.
        await expect(page).toHaveTitle(/\(mooc\) \(Workspace\)/, { timeout: 30_000 })
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
        .getByLabel("Submit", { exact: true })
        .click()
      await expect(sidePanel.getByRole("heading", { name: "Passed", exact: true })).toBeVisible()
      await expect(next).toHaveAccessibleName(/, not downloaded,/)

      // The deadline of the exercise between them has passed, so it is skipped.
      await sidePanel.getByRole("button", { name: "Next: future_deadline_exercise" }).click()

      await expect(next).toHaveAccessibleName(/, (downloaded|in workspace),/)
      await expect(page.getByRole("tab", { name: /passing_exercise\.py/ }).last()).toBeVisible()
    })

    await vsCodeTest.step(
      "exercise files open in the first group, beside the results screen, never twice",
      async () => {
        const groups = page.locator(".editor-group-container")
        const codeTabs = (group: number): Locator =>
          groups.nth(group).getByRole("tab", { name: /\.py\b/ })
        const results = sidePanel.getByRole("heading", { level: 1 })
        const shownFirst = (exercise: string): Locator =>
          groups.nth(0).getByRole("tab", { selected: true }).filter({ hasText: exercise })
        await page
          .getByRole("toolbar", { name: "Editor actions" })
          .getByLabel("Run Tests", { exact: true })
          .click()
        await expect(results).toBeVisible()
        await expect(groups).toHaveCount(2)
        await expect(codeTabs(0)).toHaveCount(2)
        await expect(codeTabs(1)).toHaveCount(0)

        // From the results screen's group, the Courses view lands on the tab already open in the
        // first group, and the Explorer opens a new file there too.
        await results.click()
        await passed.click()
        await expect(shownFirst("mixed_task_exercise")).toBeVisible()
        await groups
          .nth(1)
          .getByRole("tab", { name: /^Results/ })
          .click()
        // The exercise roots sort by name, so the first test folder is future_deadline_exercise's.
        await explorer.show()
        const files = page.getByRole("tree", { name: "Files Explorer" })
        const tests = files.getByRole("treeitem", { name: "test", exact: true }).first()
        if ((await tests.getAttribute("aria-expanded")) !== "true") {
          await tests.click()
        }
        await files.getByRole("treeitem", { name: "test_passing_exercise.py" }).first().click()
        await expect(shownFirst("test_passing_exercise.py")).toBeVisible()
        await expect(codeTabs(1)).toHaveCount(0)
        await expect(codeTabs(0)).toHaveCount(3)
        await expect(groups).toHaveCount(2)
      },
    )
  },
)
