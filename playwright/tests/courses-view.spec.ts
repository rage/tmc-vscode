import { expect } from "@playwright/test"

import { vsCodeTest } from "../fixtures"
import { CoursesViewPage } from "../pages/courses-view"

// The Courses view's bulk actions: a part's own Download, and Close and Open on a
// multi-row selection. The session comes from the tmc credentials the fixture seeds.
vsCodeTest(
  "downloads a part, then closes and opens exercises together",
  async ({ page, webview }) => {
    const coursesView = new CoursesViewPage(page, webview)
    const passing = coursesView.row("01_passing_exercise")
    const failing = coursesView.row("02_failing_exercise")

    await vsCodeTest.step("add the course and show its part", async () => {
      await coursesView.goto()
      await coursesView.addNewCourse("Python Course")
      await coursesView.expand(coursesView.row("Python Course"))
      await expect(coursesView.row("Part 1")).toHaveAccessibleName(/, 0 of 2 passed/)
    })

    await vsCodeTest.step("download every exercise of the part at once", async () => {
      await coursesView.runInlineAction(coursesView.row("Part 1"), "Download")
      await expect(passing).toHaveAccessibleName(/, open,/)
      await expect(failing).toHaveAccessibleName(/, open,/)
    })

    await vsCodeTest.step("close both from one selection", async () => {
      await passing.click()
      await failing.click({ modifiers: ["ControlOrMeta"] })
      await coursesView.runContextMenuCommand(failing, "Close")
      await expect(passing).toHaveAccessibleName(/, closed,/)
      await expect(failing).toHaveAccessibleName(/, closed,/)
    })

    // An inline action on a selected row acts on the whole selection, as in VS Code's own views.
    await vsCodeTest.step("open one on its own", async () => {
      await passing.click()
      await coursesView.runInlineAction(passing, "Open")
      await expect(passing).toHaveAccessibleName(/, open,/)
      await expect(failing).toHaveAccessibleName(/, closed,/)
    })
  },
)
