import { expect } from "@playwright/test"
import type { Locator, Page } from "@playwright/test"

import { vsCodeTest } from "../fixtures"
import { CoursesViewPage } from "../pages/courses-view"

const COURSE = "Python Course"
const FIRST_EXERCISE = "01_passing_exercise"
const SECOND_EXERCISE = "02_failing_exercise"
const MOOC_COURSE = "MOOC Python Course"
const MOOC_EXERCISE = "passing_exercise"
const RESTRICTED_MESSAGE = "This course workspace is in Restricted Mode"

vsCodeTest.use({ isWorkspaceTrustEnabled: true })

function toast(page: Page, text: string | RegExp): Locator {
  return page.locator(".notifications-toasts .notification-toast").filter({ hasText: text })
}

/** VS Code's own question, asked when untrusted folders join a trusted workspace. */
function folderTrustPrompt(page: Page): Locator {
  return page.getByText("Do you trust the authors of the files in this folder?")
}

/** Restricted Mode's indicator in the status bar. */
function restrictedModeIndicator(page: Page): Locator {
  return page.locator(".statusbar").getByText("Restricted Mode")
}

vsCodeTest(
  "one trust decision covers every course and every exercise downloaded later",
  async ({ page, webview }) => {
    const coursesView = new CoursesViewPage(page, webview)

    await vsCodeTest.step(
      "download an exercise, then open the course workspace offered",
      async () => {
        await coursesView.goto()
        await coursesView.addNewCourse(COURSE)
        await coursesView.expand(coursesView.row(COURSE))
        await coursesView.runInlineAction(coursesView.row(FIRST_EXERCISE), "Download")
        const offer = toast(page, `The exercises of ${COURSE} open in its course workspace.`)
        await offer.getByRole("button", { name: "Open Course Workspace" }).click()
      },
    )

    await vsCodeTest.step("Restricted Mode keeps the Courses view, and says why", async () => {
      await expect(restrictedModeIndicator(page)).toBeVisible()
      await coursesView.goto()
      await expect(page.getByText(RESTRICTED_MESSAGE)).toBeVisible()
      await coursesView.expand(coursesView.row(COURSE))
      await expect(coursesView.row(FIRST_EXERCISE)).toHaveAccessibleName(/, open,/)
    })

    await vsCodeTest.step(
      "Run Tests offers to trust the workspace, and runs once trusted",
      async () => {
        await coursesView.runInlineAction(coursesView.row(FIRST_EXERCISE), "Run Tests")
        const refusal = toast(page, RESTRICTED_MESSAGE)
        await refusal.getByRole("button", { name: "Trust Course Workspace" }).click()
        await page.getByRole("button", { name: "Trust", exact: true }).click()
        await expect(toast(page, /All tests of \S*01_passing_exercise passed\./)).toBeVisible()
        await expect(restrictedModeIndicator(page)).toBeHidden()
        // Newer VS Code shows the Workspace Trust editor as a modal overlay, left open after Trust.
        await page.keyboard.press("Escape")
      },
    )

    await vsCodeTest.step("a newly downloaded exercise needs no trust of its own", async () => {
      await coursesView.goto()
      await coursesView.runInlineAction(coursesView.row(SECOND_EXERCISE), "Download")
      await expect(coursesView.row(SECOND_EXERCISE)).toHaveAccessibleName(/, open,/)
      await page.keyboard.press("Control+Shift+E")
      await expect(
        page.locator(".explorer-folders-view").getByText(new RegExp(`${SECOND_EXERCISE}$`)),
      ).toBeVisible()
      await expect(folderTrustPrompt(page)).toBeHidden()
      await expect(restrictedModeIndicator(page)).toBeHidden()
    })

    await vsCodeTest.step("a second course's workspace opens trusted", async () => {
      await coursesView.goto()
      await coursesView.addNewMoocCourse(MOOC_COURSE)
      await coursesView.expand(coursesView.row(MOOC_COURSE))
      await coursesView.runContextMenuCommand(coursesView.row(MOOC_EXERCISE), "Open")
      const offer = toast(page, `The exercises of ${MOOC_COURSE} open in its course workspace.`)
      await offer.getByRole("button", { name: "Open Course Workspace" }).click()
      // The window reloads into the course workspace, named after its file.
      await expect(page).toHaveTitle(/\(mooc\)/, { timeout: 30_000 })

      await coursesView.goto()
      await coursesView.expand(coursesView.row(MOOC_COURSE))
      await expect(coursesView.row(MOOC_EXERCISE)).toHaveAccessibleName(/, open,/)
      await expect(page.getByText(RESTRICTED_MESSAGE)).toBeHidden()
      await expect(restrictedModeIndicator(page)).toBeHidden()
      await coursesView.runInlineAction(coursesView.row(MOOC_EXERCISE), "Run Tests")
      await expect(toast(page, /All tests of \S*passing_exercise passed\./)).toBeVisible()
    })
  },
)
