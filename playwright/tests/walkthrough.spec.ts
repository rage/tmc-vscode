import { expect } from "@playwright/test"

import { vsCodeTest } from "../fixtures"
import { CoursesViewPage } from "../pages/courses-view"
import { QuickPickPage } from "../pages/quick-pick"
import { TmcPage } from "../pages/tmc"

// Every test starts from an empty profile, which activation treats as a fresh install.
vsCodeTest("a fresh install opens the walkthrough", async ({ page, webview }) => {
  const tmcPage = new TmcPage(page, webview)

  await tmcPage.openMenu()

  await expect(page.getByText("Get Started with TestMyCode").first()).toBeVisible()
})

// The fixture's stored session exists before VS Code first shows the walkthrough.
vsCodeTest("a session from before the walkthrough ticks off Log in", async ({ page, webview }) => {
  await new TmcPage(page, webview).openMenu()

  const logIn = page.locator(".getting-started-step").filter({ hasText: "Log in" }).first()
  await expect(logIn.locator(".codicon-getting-started-step-checked")).toBeVisible()
})

vsCodeTest.describe(() => {
  vsCodeTest.use({ seedTmcCredentials: false })

  vsCodeTest(
    "logging in from the walkthrough leaves the keyboard in the Add Course pick",
    async ({ page, webview }) => {
      const courseTitle = "MOOC Python Course"
      await new TmcPage(page, webview).openMenu()
      const logIn = page.locator(".getting-started-step").filter({ hasText: "Log in" }).first()
      // The step's button does nothing until the extension has activated, which its status
      // bar item shows.
      await expect(
        page
          .locator('[id="workbench.parts.statusbar"]')
          .getByRole("button", { name: /not logged in/ }),
      ).toBeVisible({ timeout: 30_000 })
      await logIn.getByRole("button", { name: "Log In", exact: true }).click()

      const quickPick = new QuickPickPage(page)
      await quickPick.waitForTitle("Add Course")
      await quickPick.expectItem(courseTitle)
      await page.keyboard.type(courseTitle)
      await page.keyboard.press("Enter")
      await quickPick.expectClosed()
      const coursesView = new CoursesViewPage(page, webview)
      await coursesView.goto()
      await expect(coursesView.row(courseTitle)).toBeVisible()
    },
  )
})

vsCodeTest(
  "running tests and submitting from a notification tick off their walkthrough steps",
  async ({ page, webview }) => {
    const coursesView = new CoursesViewPage(page, webview)
    const course = "Python Course"
    const exercise = "01_passing_exercise"

    await vsCodeTest.step("download an exercise and open the course workspace", async () => {
      await coursesView.goto()
      await coursesView.addNewCourse(course)
      await coursesView.expand(coursesView.row(course))
      await coursesView.runInlineAction(coursesView.row(exercise), "Download")
      await coursesView.runInlineAction(coursesView.row(course), "Open Course Workspace")
    })

    await vsCodeTest.step("run the tests and submit from the notification", async () => {
      await coursesView.goto()
      await coursesView.expand(coursesView.row(course))
      await coursesView.runInlineAction(coursesView.row(exercise), "Run Tests")
      const passed = page
        .locator(".notifications-toasts .notification-toast")
        .filter({ hasText: new RegExp(`All tests of \\S*${exercise} passed\\.`) })
      await passed.getByRole("button", { name: "Submit", exact: true }).click()
      await expect(
        new TmcPage(page, webview)
          .getSidePanel()
          .getByRole("heading", { name: "All tests passed on the server" }),
      ).toBeVisible({ timeout: 30_000 })
    })

    await vsCodeTest.step("the walkthrough has both steps ticked", async () => {
      await coursesView.runPaletteCommand("TestMyCode: Get Started")
      for (const step of ["Run the tests", "Submit your solution"]) {
        await expect(
          page
            .locator(".getting-started-step")
            .filter({ hasText: step })
            .first()
            .locator(".codicon-getting-started-step-checked"),
        ).toBeVisible()
      }
    })
  },
)
