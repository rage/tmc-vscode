import { expect } from "@playwright/test"
import type { Page } from "@playwright/test"

import { MOCK_BACKEND_URL } from "../../backend/mockSession"
import { MOCK_DEFAULT_USER_ID } from "../../backend/mooc/fixtures"
import { vsCodeTest } from "../fixtures"
import { CoursesViewPage } from "../pages/courses-view"
import { MoocLoginPage } from "../pages/mooc-login"
import { QuickPickPage } from "../pages/quick-pick"

const OTHER_STUDENT_ID = "0d6a3a7e-1f0b-4c8e-8f3d-6b2a9c4e5f70"

function accountStatusBarItem(page: Page, name: RegExp) {
  return page.locator('[id="workbench.parts.statusbar"]').getByRole("button", { name })
}

async function setCurrentUser(id: string): Promise<void> {
  const switched = await fetch(`${MOCK_BACKEND_URL}/mooc-mock/set-current-user`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id }),
  })
  expect(switched.status).toBe(204)
}

vsCodeTest.describe(() => {
  vsCodeTest.use({ seedTmcCredentials: false })

  vsCodeTest(
    "another student logging in can move the exercises aside until their owner is back",
    async ({ page, webview }) => {
      const coursesView = new CoursesViewPage(page, webview)
      const moocLoginPage = new MoocLoginPage(page, webview)
      const courseTitle = "MOOC Python Course"
      const exerciseName = "passing_exercise"

      await vsCodeTest.step("the first student logs in and downloads an exercise", async () => {
        await moocLoginPage.gotoFromCoursesView()
        await expect(moocLoginPage.statusBarMessage("Logged in to courses.mooc.fi.")).toBeVisible()
        const quickPick = new QuickPickPage(page)
        await quickPick.waitForTitle("Add Course")
        await quickPick.selectByLabel(courseTitle)
        await quickPick.expectClosed()
        await coursesView.goto()
        await coursesView.expand(coursesView.row(courseTitle))
        const row = coursesView.row(exerciseName)
        await coursesView.runContextMenuCommand(row, "Open")
        await expect(row).toHaveAccessibleName(/, open,/)
      })

      await vsCodeTest.step("they log out and another student logs in", async () => {
        await coursesView.runPaletteCommand("TestMyCode: Log Out")
        await expect(coursesView.statusBarMessage("Logged out.")).toBeVisible()
        await setCurrentUser(OTHER_STUDENT_ID)
        await accountStatusBarItem(page, /not logged in/).click()
        await expect(moocLoginPage.statusBarMessage("Logged in to courses.mooc.fi.")).toBeVisible()
      })

      await vsCodeTest.step("moving the first student's exercises aside", async () => {
        const dialog = moocLoginPage
          .modalDialog()
          .filter({ hasText: "were downloaded by another courses.mooc.fi account" })
        await expect(dialog).toBeVisible()
        await dialog.getByRole("button", { name: "Move Them Aside" }).click()
        await expect(
          coursesView.notificationToast("Moved the other account's exercises to"),
        ).toBeVisible()
        await expect(coursesView.row(exerciseName)).toHaveAccessibleName(/, not downloaded,/)
      })

      await vsCodeTest.step("the first student logging in again gets them back", async () => {
        await coursesView.runPaletteCommand("TestMyCode: Log Out")
        await expect(coursesView.statusBarMessage("Logged out.")).toBeVisible()
        await setCurrentUser(MOCK_DEFAULT_USER_ID)
        await accountStatusBarItem(page, /not logged in/).click()
        await expect(
          coursesView.notificationToast("Brought back your exercises that another login moved"),
        ).toBeVisible()
        await expect(moocLoginPage.modalDialog()).toBeHidden()
        await expect(coursesView.row(exerciseName)).not.toHaveAccessibleName(/, not downloaded,/)
      })
    },
  )
})
