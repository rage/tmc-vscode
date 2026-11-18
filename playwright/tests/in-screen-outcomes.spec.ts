import * as os from "node:os"

import { expect } from "@playwright/test"

import { MOCK_BACKEND_URL } from "../../backend/mockSession"
import { passingExercise } from "../../backend/mooc/fixtures"
import { vsCodeTest } from "../fixtures"
import { CourseHomePage } from "../pages/course-home"
import { CoursesViewPage } from "../pages/courses-view"
import { ExplorerPage } from "../pages/explorer"
import { TmcPage } from "../pages/tmc"

// What a screen says in place of a notification. A failure of something it started shows in it,
// and a notification tells of the failure only while the screen is out of sight. A local pass
// while logged out shows in the results screen. backend/mooc serves the course and fails a
// download on request.

const COURSE_TITLE = "MOOC Python Course"

async function failNextArchiveDownload(delayMs = 0): Promise<void> {
  const armed = await fetch(`${MOCK_BACKEND_URL}/mooc-mock/fail-next-archive`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ delayMs }),
  })
  expect(armed.status).toBe(204)
}

vsCodeTest(
  "Course Details shows a failed download in place, and notifies it only while hidden",
  async ({ page, webview }) => {
    const coursesView = new CoursesViewPage(page, webview)
    const courseHome = new CourseHomePage(page, webview)
    const tmc = new TmcPage(page, webview)
    const failure = courseHome.webview.getByRole("alert").filter({ hasText: /Failed to download/ })
    const toast = page
      .locator(".notifications-toasts .notification-toast")
      .filter({ hasText: /Failed to download/ })

    await vsCodeTest.step("a failure on screen shows in Course Details alone", async () => {
      await coursesView.goto()
      await coursesView.addNewMoocCourse(COURSE_TITLE)
      await courseHome.expectShown(COURSE_TITLE)
      await failNextArchiveDownload()

      await courseHome.downloadAll()

      await expect(failure).toBeVisible({ timeout: 30_000 })
      await expect(failure.getByRole("button", { name: "Show Details" })).toBeVisible()
      await expect(toast).toHaveCount(0)
    })

    await vsCodeTest.step(
      "it blames the server, and its details keep tmc-langs' reason without the home folder",
      async () => {
        await expect(failure).toContainText("The server ran into a problem. Try again later.")
        await failure.getByRole("button", { name: "Show Details" }).click()

        const details = await tmc.panelHeaded("Error Details")
        await expect(details.getByRole("group", { name: "Cause" })).toContainText(
          "500 Internal Server Error from",
        )
        await expect(details.getByRole("button", { name: "Show Logs" })).not.toHaveAttribute(
          "secondary",
        )
        await expect(details.getByRole("button", { name: "Copy Details" })).toHaveAttribute(
          "secondary",
        )
        await expect(details.getByRole("group", { name: "Recent log" })).toBeVisible()
        expect(await details.locator("body").textContent()).not.toContain(os.homedir())
        // The steps after this read the webview shown last, which must be Course Details again.
        await page.getByRole("tab", { name: /^Error Details/ }).click()
        await tmc.runPaletteCommand("View: Close Editor")
        await expect(page.getByRole("tab", { name: /^Error Details/ })).toHaveCount(0)
      },
    )

    await vsCodeTest.step("dismissing it removes it", async () => {
      await failure.locator('vscode-toolbar-button[title="Dismiss this error"]').click()
      await expect(failure).toHaveCount(0)
    })

    await vsCodeTest.step(
      "a failure while hidden is notified, and shown once Course Details is back",
      async () => {
        await failNextArchiveDownload(8_000)
        // The course's Download leaves out an exercise whose download failed; its row offers it.
        await courseHome.webview
          .locator('vscode-toolbar-button[title="Download passing_exercise"]')
          .click()
        await tmc.runPaletteCommand("File: New Untitled Text File")
        await expect(courseHome.heading(COURSE_TITLE)).toBeHidden()

        await expect(toast).toBeVisible({ timeout: 30_000 })
        await courseHome.reveal(COURSE_TITLE)
        await expect(failure).toBeVisible()
      },
    )
  },
)

vsCodeTest(
  "a pass while logged out offers Log In to Submit, and with nothing left Course Details says so",
  async ({ page, webview }) => {
    const coursesView = new CoursesViewPage(page, webview)
    const tmc = new TmcPage(page, webview)
    const code = page.locator(".monaco-editor").getByText("def hello()")
    const passToast = page
      .locator(".notifications-toasts .notification-toast")
      .filter({ hasText: "All tests of passing_exercise passed" })

    await vsCodeTest.step("open the exercise in its course workspace, then log out", async () => {
      await coursesView.goto()
      await coursesView.addNewMoocCourse(COURSE_TITLE)
      await coursesView.expand(coursesView.row(COURSE_TITLE))
      const row = coursesView.row("passing_exercise")
      await coursesView.runContextMenuCommand(row, "Open")
      await expect(row).toHaveAccessibleName(/, (downloaded|in workspace),/)
      await coursesView.openCourseWorkspace(COURSE_TITLE)
      await new ExplorerPage(page).openPath(["src", "passing_exercise.py"])
      await expect(code).toBeVisible({ timeout: 30_000 })
      await coursesView.runPaletteCommand("TestMyCode: Log Out")
      await expect(coursesView.statusBarMessage("Logged out.")).toBeVisible()
    })

    await vsCodeTest.step("passing tests offer to log in from the results screen", async () => {
      await code.click()
      await page
        .getByRole("toolbar", { name: "Editor actions" })
        .getByLabel("Run Tests", { exact: true })
        .click()
      const results = await tmc.panelHeaded("passing_exercise")
      await expect(
        results.getByRole("heading", { name: "Tests pass on your computer" }),
      ).toBeVisible()
      await expect(passToast).toHaveCount(0)

      await results.getByRole("button", { name: "Log In to Submit" }).click()

      await expect(results.getByRole("heading", { name: "Passed", exact: true })).toBeVisible({
        timeout: 30_000,
      })
    })

    await vsCodeTest.step("Open Next Exercise with nothing left opens Course Details", async () => {
      await code.click()
      await tmc.runExercisePaletteCommand("TestMyCode: Open Next Exercise")

      const courseHome = await tmc.panelHeaded(COURSE_TITLE)
      await expect(
        courseHome.getByRole("list", { name: "Course notices" }).getByText("Nothing left to do"),
      ).toBeVisible({ timeout: 30_000 })
    })
  },
)

vsCodeTest(
  "after a Log Out, an exercise not downloaded asks to log in, and is not marked failed",
  async ({ page, webview }) => {
    const coursesView = new CoursesViewPage(page, webview)
    const courseHome = new CourseHomePage(page, webview)
    const loginToast = page
      .locator(".notifications-toasts .notification-toast")
      .filter({ hasText: "Log in with your MOOC.fi account" })

    await vsCodeTest.step("add the course, then log out", async () => {
      await coursesView.goto()
      await coursesView.addNewMoocCourse(COURSE_TITLE)
      await courseHome.expectShown(COURSE_TITLE)
      await coursesView.runPaletteCommand("TestMyCode: Log Out")
      await expect(coursesView.statusBarMessage("Logged out.")).toBeVisible()
    })

    await vsCodeTest.step(
      "the course home offers no download, only its notice's Log In",
      async () => {
        await expect(courseHome.notices()).toContainText("Not logged in")
        await expect(courseHome.row("passing_exercise")).toContainText("Not downloaded")
        await expect(
          courseHome.webview.getByRole("button", { name: "passing_exercise", exact: true }),
        ).toHaveCount(0)
        await expect(courseHome.webview.getByRole("alert")).toHaveCount(0)
      },
    )

    await vsCodeTest.step("opening it from the Courses view asks to log in", async () => {
      await coursesView.expand(coursesView.row(COURSE_TITLE))
      const row = coursesView.row("passing_exercise")
      // Logged out, its menu offers no Open or Download; a click on the row still opens it.
      await row.click()

      await expect(loginToast).toBeVisible({ timeout: 30_000 })
      await expect(row).not.toHaveAccessibleName(/download failed/i)
      await expect(courseHome.row("passing_exercise")).toContainText("Not downloaded")
      await expect(courseHome.webview.getByRole("alert")).toHaveCount(0)
    })
  },
)

vsCodeTest(
  "a failed update shows in Course Details' updates notice, with Try Again",
  async ({ page, webview }) => {
    const coursesView = new CoursesViewPage(page, webview)
    const courseHome = new CourseHomePage(page, webview)
    const failedNotice = courseHome.notices().getByText(/Couldn't update 1 exercise/)

    await vsCodeTest.step("download the course's exercise", async () => {
      await coursesView.goto()
      await coursesView.addNewMoocCourse(COURSE_TITLE)
      await courseHome.expectShown(COURSE_TITLE)
      await courseHome.downloadAll()
      await courseHome.expectState("passing_exercise", "Downloaded")
    })

    await vsCodeTest.step("an update that fails shows as a warning in its notice", async () => {
      const published = await fetch(`${MOCK_BACKEND_URL}/mooc-mock/publish-exercise-update`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ exercise_id: passingExercise.slide.exercise_id }),
      })
      expect(published.status).toBe(204)
      await failNextArchiveDownload()

      // Updates install automatically once the check finds them, so this one fails at once.
      await coursesView.runPaletteCommand("TestMyCode: Update Exercises")

      await expect(failedNotice).toBeVisible({ timeout: 30_000 })
      await expect(courseHome.webview.getByRole("alert")).toHaveCount(0)
    })

    await vsCodeTest.step("Try Again updates the exercise and clears the warning", async () => {
      await courseHome.notices().getByRole("button", { name: "Try Again" }).click()

      await expect(failedNotice).toBeHidden({ timeout: 30_000 })
      await expect(courseHome.notices().getByText(/update/)).toHaveCount(0)
    })
  },
)
