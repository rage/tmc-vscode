import * as fs from "fs"
import { join } from "node:path"

import { expect } from "@playwright/test"
import type { FrameLocator, Page } from "@playwright/test"

import { CLIENT_CONFIG_DIR_NAME, MOCK_BACKEND_URL } from "../../backend/mockSession"
import { vsCodeTest } from "../fixtures"
import { AddCoursePage } from "../pages/add-course"
import { CoursesViewPage } from "../pages/courses-view"
import { MoocLoginPage } from "../pages/mooc-login"
import { TmcPage } from "../pages/tmc"

vsCodeTest.use({ isCoursesMoocFiEnabled: true })

// Session situations a single, connected, freshly logged-in window never meets.

const COURSE = "MOOC Python Course"

async function setConnectionsDropped(dropped: boolean): Promise<void> {
  const res = await fetch(`${MOCK_BACKEND_URL}/mooc-mock/set-connections-dropped`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ dropped }),
  })
  expect(res.status).toBe(204)
}

/** Logs in with the device flow from the Courses view of a profile with no credentials. */
async function logIn(page: Page, webview: FrameLocator): Promise<void> {
  const login = new MoocLoginPage(page, webview)
  await login.gotoFromCoursesView()
  await expect(login.statusBarMessage("Logged in.")).toBeVisible()
}

vsCodeTest.describe(() => {
  vsCodeTest.use({ seedTmcCredentials: false })

  vsCodeTest(
    "logging out with the backend unreachable still logs out here",
    async ({ page, webview }) => {
      const coursesView = new CoursesViewPage(page, webview)
      await logIn(page, webview)

      await setConnectionsDropped(true)
      try {
        await coursesView.runPaletteCommand("TestMyCode: Log Out")
        await expect(coursesView.statusBarMessage("Logged out.")).toBeVisible()
      } finally {
        await setConnectionsDropped(false)
      }
    },
  )

  vsCodeTest(
    "a window that starts with the backend unreachable keeps the stored course and login",
    async ({ page, webview }) => {
      const coursesView = new CoursesViewPage(page, webview)
      const tmc = new TmcPage(page, webview)
      await logIn(page, webview)
      await new AddCoursePage(page, webview).addMoocCourse(COURSE)
      await coursesView.goto()
      await expect(coursesView.row(COURSE)).toBeVisible()

      await setConnectionsDropped(true)
      try {
        await tmc.reloadingWindow(() => tmc.runPaletteCommand("Developer: Reload Window"))
        await coursesView.goto()
        await expect(coursesView.row(COURSE)).toBeVisible({ timeout: 60_000 })
      } finally {
        await setConnectionsDropped(false)
      }
    },
  )
})

vsCodeTest.describe(() => {
  vsCodeTest.use({ isCoursesMoocFiEnabled: true })

  vsCodeTest(
    "a login from 3.5.5 on the shared credentials file has no mooc login, which Add Course offers",
    async ({ configDir, page, webview }) => {
      const stored = join(configDir, CLIENT_CONFIG_DIR_NAME, "credentials.json")
      expect(fs.existsSync(stored)).toBe(true)
      const coursesView = new CoursesViewPage(page, webview)
      await coursesView.goto()

      const addCourse = await coursesView.openAddCourse()

      await expect(addCourse.card("Test Organization")).toBeVisible()
      await expect(
        addCourse.section("courses.mooc.fi").getByRole("button", { name: "Log In" }),
      ).toBeVisible()
    },
  )
})
