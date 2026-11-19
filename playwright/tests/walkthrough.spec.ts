import { expect } from "@playwright/test"
import type { Locator, Page } from "@playwright/test"

import { vsCodeTest } from "../fixtures"
import { AddCoursePage } from "../pages/add-course"
import { CourseHomePage } from "../pages/course-home"
import { CoursesViewPage } from "../pages/courses-view"
import { MoocLoginPage } from "../pages/mooc-login"
import { QuickPickPage } from "../pages/quick-pick"
import { TmcPage } from "../pages/tmc"

function walkthroughStep(page: Page, title: string): Locator {
  // Titles such as "Submit" also occur in other steps' text, so match the title alone.
  return page
    .locator(".getting-started-step")
    .filter({ has: page.locator(".step-title").getByText(title, { exact: true }) })
    .first()
}

// Every test starts from an empty profile, which activation treats as a fresh install.
vsCodeTest("a fresh install opens the walkthrough", async ({ page, webview }) => {
  const tmcPage = new TmcPage(page, webview)

  await tmcPage.openMenu()

  await expect(page.getByText("Get Started with TestMyCode").first()).toBeVisible()
})

// The fixture's stored session exists before VS Code first shows the walkthrough.
vsCodeTest("a session from before the walkthrough ticks off Log in", async ({ page, webview }) => {
  await new TmcPage(page, webview).openMenu()

  const logIn = walkthroughStep(page, "Log In")
  await expect(logIn.locator(".codicon-getting-started-step-checked")).toBeVisible()
})

vsCodeTest.describe(() => {
  vsCodeTest.use({ seedTmcCredentials: false })

  vsCodeTest(
    "logging in from the walkthrough goes on to the add-course screen, then the course home",
    async ({ page, webview }) => {
      const courseTitle = "MOOC Python Course"
      await new TmcPage(page, webview).openMenu()
      const logIn = walkthroughStep(page, "Log In")
      // The step's button does nothing until the extension has activated, which its status
      // bar item shows.
      await expect(
        page
          .locator('[id="workbench.parts.statusbar"]')
          .getByRole("button", { name: /not logged in/ }),
      ).toBeVisible({ timeout: 30_000 })
      await logIn.getByRole("button", { name: "Log In", exact: true }).click()

      const addCourse = new AddCoursePage(page, webview)
      await addCourse.expectShown()
      await addCourse.addMoocCourse(courseTitle)
      await new CourseHomePage(page, webview).expectShown(courseTitle)
      const coursesView = new CoursesViewPage(page, webview)
      await coursesView.goto()
      await expect(coursesView.row(courseTitle)).toBeVisible()
    },
  )

  vsCodeTest("the Add Course step opens the add-course screen", async ({ page, webview }) => {
    const loginScreen = new MoocLoginPage(page, webview)
    await loginScreen.gotoFromCoursesView()
    await expect(loginScreen.statusBarMessage("Logged in.")).toBeVisible()
    const addCourseTab = page.getByRole("tab", { name: /^Add Course/ })
    await addCourseTab.hover()
    await addCourseTab.getByRole("button", { name: /^Close/ }).click()

    await loginScreen.runPaletteCommand("TestMyCode: Get Started")
    const step = walkthroughStep(page, "Add Course")
    await step.click()
    await step.getByRole("button", { name: "Add Course", exact: true }).click()

    await new AddCoursePage(page, webview).expectShown()
  })
})

vsCodeTest(
  "running tests and submitting from the results screen tick off their walkthrough steps",
  async ({ page, webview }) => {
    const coursesView = new CoursesViewPage(page, webview)
    const course = "Python Course"
    const exercise = "01_passing_exercise"

    await vsCodeTest.step("download an exercise and open the course workspace", async () => {
      await coursesView.goto()
      await coursesView.addNewCourse(course)
      await coursesView.expand(coursesView.row(course))
      await coursesView.runInlineAction(coursesView.row(exercise), "Download")
      await coursesView.openCourseWorkspace(course)
    })

    await vsCodeTest.step("run the tests and submit from the results screen", async () => {
      await coursesView.goto()
      await coursesView.expand(coursesView.row(course))
      await coursesView.runInlineAction(coursesView.row(exercise), "Run Tests")
      const sidePanel = new TmcPage(page, webview).getSidePanel()
      await expect(
        sidePanel.getByRole("heading", { name: "Tests pass on your computer" }),
      ).toBeVisible()
      await sidePanel.getByRole("button", { name: "Submit", exact: true }).click()
      await expect(sidePanel.getByRole("heading", { name: "Passed", exact: true })).toBeVisible({
        timeout: 30_000,
      })
    })

    await vsCodeTest.step(
      "the walkthrough has both steps ticked, also in a new window",
      async () => {
        // A window opened later, as a course workspace's is, knows the milestones only from storage.
        await coursesView.reloadingWindow(() =>
          coursesView.runPaletteCommand("Developer: Reload Window"),
        )
        await coursesView.goto()
        await expect(coursesView.row(course)).toBeVisible({ timeout: 30_000 })
        await coursesView.runPaletteCommand("TestMyCode: Get Started")
        for (const step of ["Run Tests", "Submit"]) {
          await expect(
            walkthroughStep(page, step).locator(".codicon-getting-started-step-checked"),
          ).toBeVisible()
        }
        // It opens on the step left to do, not on Log In with its button.
        await expect(walkthroughStep(page, "Get Help")).toHaveClass(/\bexpanded\b/)
        await expect(
          walkthroughStep(page, "Log In").getByRole("button", { name: "Log In", exact: true }),
        ).toBeHidden()
      },
    )
  },
)

// The walkthrough tab is no exercise file, and a button passes no course, so a step's button
// must not need either.
vsCodeTest(
  "the exercise steps' buttons open the course home and the exercise to continue with",
  async ({ page, webview }) => {
    const coursesView = new CoursesViewPage(page, webview)
    const courseHome = new CourseHomePage(page, webview)
    const quickPick = new QuickPickPage(page)
    const course = "Python Course"
    const errorToasts = page.locator(".notifications-toasts .codicon-error")
    const runTests = page
      .getByRole("toolbar", { name: "Editor actions" })
      .getByLabel("Run Tests", { exact: true })

    async function clickStepButton(step: string, button: string): Promise<void> {
      await coursesView.runPaletteCommand("TestMyCode: Get Started")
      await walkthroughStep(page, step).click()
      await walkthroughStep(page, step).getByRole("button", { name: button, exact: true }).click()
    }

    await vsCodeTest.step("Download and Open Exercises opens the course home", async () => {
      await coursesView.goto()
      await coursesView.addNewCourse(course)
      const courseTab = page.getByRole("tab", { name: new RegExp(`^${course}`) })
      await courseTab.hover()
      await courseTab.getByRole("button", { name: /^Close/ }).click()

      await clickStepButton("Download and Open Exercises", "Open Course Home")

      await courseHome.expectShown(course)
      await quickPick.expectClosed()
      await expect(errorToasts).toHaveCount(0)
    })

    await vsCodeTest.step("download an exercise and open the course workspace", async () => {
      await coursesView.goto()
      await coursesView.expand(coursesView.row(course))
      await coursesView.runInlineAction(coursesView.row("01_passing_exercise"), "Download")
      await coursesView.openCourseWorkspace(course)
      // Wait for the reopened window's Course Details, or it opens over the walkthrough.
      await courseHome.expectShown(course)
    })

    for (const step of ["Run Tests", "Submit"]) {
      await vsCodeTest.step(`${step} opens the exercise to continue with`, async () => {
        await coursesView.runPaletteCommand("View: Close All Editors")
        await expect(runTests).toBeHidden()

        await clickStepButton(step, "Continue with an Exercise")

        await expect(runTests).toBeVisible()
        await quickPick.expectClosed()
        await expect(errorToasts).toHaveCount(0)
      })
    }
  },
)
