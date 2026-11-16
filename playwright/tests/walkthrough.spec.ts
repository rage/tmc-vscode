import { expect } from "@playwright/test"

import { vsCodeTest } from "../fixtures"
import { AddCoursePage } from "../pages/add-course"
import { CourseHomePage } from "../pages/course-home"
import { CoursesViewPage } from "../pages/courses-view"
import { MoocLoginPage } from "../pages/mooc-login"
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
    "logging in from the walkthrough goes on to the add-course screen, then the course home",
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

      const addCourse = new AddCoursePage(page, webview)
      await addCourse.expectShown()
      await addCourse.addMoocCourse(courseTitle)
      await new CourseHomePage(page, webview).expectShown(courseTitle)
      const coursesView = new CoursesViewPage(page, webview)
      await coursesView.goto()
      await expect(coursesView.row(courseTitle)).toBeVisible()
    },
  )

  vsCodeTest("the Add a course step opens the add-course screen", async ({ page, webview }) => {
    const loginScreen = new MoocLoginPage(page, webview)
    await loginScreen.gotoFromCoursesView()
    await expect(loginScreen.statusBarMessage("Logged in to courses.mooc.fi.")).toBeVisible()
    const addCourseTab = page.getByRole("tab", { name: /^Add Course/ })
    await addCourseTab.hover()
    await addCourseTab.getByRole("button", { name: /^Close/ }).click()

    await loginScreen.runPaletteCommand("TestMyCode: Get Started")
    const step = page.locator(".getting-started-step").filter({ hasText: "Add a course" }).first()
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
      await coursesView.runInlineAction(coursesView.row(course), "Open Course Workspace")
    })

    await vsCodeTest.step("run the tests and submit from the results screen", async () => {
      await coursesView.goto()
      await coursesView.expand(coursesView.row(course))
      await coursesView.runInlineAction(coursesView.row(exercise), "Run Tests")
      const sidePanel = new TmcPage(page, webview).getSidePanel()
      await expect(
        sidePanel.getByRole("heading", { name: "All tests passed locally" }),
      ).toBeVisible()
      await sidePanel.getByRole("button", { name: "Submit", exact: true }).click()
      await expect(
        sidePanel.getByRole("heading", { name: "All tests passed on the server" }),
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
