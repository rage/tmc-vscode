import * as fs from "fs"
import { join } from "node:path"

import { expect } from "@playwright/test"
import type { Page } from "@playwright/test"

import { MOCK_BACKEND_URL } from "../../backend/mockSession"
import { pythonCourse } from "../../backend/mooc/fixtures"
import { vsCodeTest } from "../fixtures"
import { AddCoursePage } from "../pages/add-course"
import { CoursesViewPage } from "../pages/courses-view"
import { MoocLoginPage } from "../pages/mooc-login"
import { TmcPage } from "../pages/tmc"

// `testMyCode.experimental.coursesMoocFi` only decides whether courses.mooc.fi courses can be
// added; courses already stored keep working with it off, which is 4.0.0's state after a user
// switches it off again.

const COURSE_TITLE = "MOOC Python Course"
const SETTING = "testMyCode.experimental.coursesMoocFi"

const submitButton = (page: Page) =>
  page.getByRole("toolbar", { name: "Editor actions" }).getByLabel("Submit", { exact: true })

vsCodeTest.describe(() => {
  vsCodeTest.use({ isCoursesMoocFiEnabled: true })

  vsCodeTest(
    "a stored mooc course still downloads and submits once the setting is off",
    async ({ page, userDataDir, webview }) => {
      const coursesView = new CoursesViewPage(page, webview)
      const sidePanel = new TmcPage(page, webview).getSidePanel()

      // Without an AI policy a course submits from its course workspace only.
      const policy = await fetch(`${MOCK_BACKEND_URL}/mooc-mock/set-ai-policy`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ course_id: pythonCourse.id, ai_policy: "full_use" }),
      })
      expect(policy.status).toBe(204)
      await coursesView.goto()
      await coursesView.addNewMoocCourse(COURSE_TITLE)

      const settingsFile = join(userDataDir, "User", "settings.json")
      const settings = JSON.parse(fs.readFileSync(settingsFile, "utf-8")) as Record<string, unknown>
      fs.writeFileSync(settingsFile, JSON.stringify({ ...settings, [SETTING]: false }))
      await coursesView.goto()
      await coursesView.expand(coursesView.row(COURSE_TITLE))

      const exercise = coursesView.row("passing_exercise")
      await exercise.click()
      await expect(exercise).toHaveAccessibleName(/, (downloaded|in workspace),/)
      await page.locator(".monaco-editor").first().click()
      await submitButton(page).click()

      await expect(sidePanel.getByRole("heading", { name: "Passed", exact: true })).toBeVisible()
    },
  )
})

// No override: runs with whatever default the extension ships, so flipping it in package.json
// (and Settings) is what this follows.
vsCodeTest.describe(() => {
  vsCodeTest.use({ seedTmcCredentials: false })

  vsCodeTest(
    "a fresh profile's walkthrough follows the shipped default",
    async ({ page, webview }) => {
      const manifest = JSON.parse(
        fs.readFileSync(join(__dirname, "..", "..", "package.json"), "utf8"),
      ) as {
        contributes: { configuration: { properties: Record<string, { default: boolean }> } }
      }
      const isOnByDefault = manifest.contributes.configuration.properties[SETTING]?.default === true
      const tmc = new TmcPage(page, webview)

      await tmc.openMenu()
      await tmc.expectWalkthroughShown()
      const logIn = page
        .locator(".getting-started-step")
        .filter({ has: page.locator(".step-title").getByText("Log In", { exact: true }) })
        .first()
      await expect(
        page
          .locator('[id="workbench.parts.statusbar"]')
          .getByRole("button", { name: /not logged in/ }),
      ).toBeVisible({ timeout: 30_000 })
      await logIn.getByRole("button", { name: "Log In", exact: true }).click()
      await expect(new MoocLoginPage(page, webview).statusBarMessage("Logged in.")).toBeVisible()

      if (isOnByDefault) {
        const addCourse = new AddCoursePage(page, webview)
        await addCourse.expectShown()
        await expect(addCourse.section("courses.mooc.fi")).toBeVisible()
      }
    },
  )
})
