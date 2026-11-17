import { expect } from "@playwright/test"
import type { Page } from "@playwright/test"

import { vsCodeTest } from "../fixtures"
import { CourseHomePage } from "../pages/course-home"
import { CoursesViewPage } from "../pages/courses-view"
import { QuickPickPage } from "../pages/quick-pick"

// Adding a course from the add-course screen, here from the tmc.mooc.fi side; the
// Command Palette keeps a quick pick as its fast path. The session comes from the tmc
// credentials the fixture seeds (fixtures.ts).

vsCodeTest("can add new course", async ({ page, webview }) => {
  const coursesView = new CoursesViewPage(page, webview)
  const courseHome = new CourseHomePage(page, webview)

  await vsCodeTest.step("open the Courses view", async () => {
    await coursesView.goto()
  })

  await vsCodeTest.step(
    "add the course from its organization on the add-course screen",
    async () => {
      const course = coursesView.row("Python Course")
      await expect(course).toBeHidden()
      const addCourse = await coursesView.openAddCourse()
      const organization = addCourse.card("Test Organization")
      await expect(organization).toBeVisible()
      await addCourse.addTmcCourse("Test Organization", "Python Course")
      await expect(course).toBeVisible()
    },
  )

  await vsCodeTest.step("its course home opens, listing its part and exercises", async () => {
    await courseHome.expectShown("Python Course")
    await expect(courseHome.webview.getByRole("button", { name: "Part 1" })).toBeVisible()
    await courseHome.expectState("01_passing_exercise", "Not downloaded")
    await expect(courseHome.row("01_passing_exercise")).toContainText("0/1")
  })

  await vsCodeTest.step(
    "opening an exercise from its row downloads it and shows its code",
    async () => {
      await courseHome.openExercise("01_passing_exercise")
      await expect(page.getByRole("tab", { name: /passing_exercise\.py/ })).toBeVisible()
      await courseHome.reveal("Python Course")
      await courseHome.expectState("01_passing_exercise", "Downloaded")
      await expect(courseHome.row("02_failing_exercise")).toContainText("Not downloaded")
    },
  )

  await vsCodeTest.step("the screen shows the course as added, and opens it", async () => {
    const addCourse = await coursesView.openAddCourse()
    await addCourse
      .section("tmc.mooc.fi")
      .getByRole("button", { name: "Show the courses of Test Organization" })
      .click()
    await addCourse.search("python course")
    const card = addCourse.card("Python Course")
    await expect(card).toContainText("Added")
    await card.getByRole("button", { name: "Open Python Course" }).click()
    await courseHome.expectShown("Python Course")
  })
})

vsCodeTest("search narrows the organizations as it is typed", async ({ page, webview }) => {
  const coursesView = new CoursesViewPage(page, webview)
  await coursesView.goto()

  const addCourse = await coursesView.openAddCourse()
  await expect(addCourse.card("Test Organization")).toBeVisible()
  await addCourse.search("no such organization")

  await expect(addCourse.card("Test Organization")).toBeHidden()
  await expect(
    addCourse.section("tmc.mooc.fi").getByText("Nothing here matches “no such organization”."),
  ).toBeVisible()
})

/**
 * The palette lists a command by the context keys as they are when it opens, so this waits for
 * the view's Add Course action, shown under the same activation keys.
 */
async function waitForActivation(page: Page): Promise<void> {
  const addCourse = page
    .getByRole("toolbar", { name: "TestMyCode: Courses actions" })
    .getByRole("button", { name: "Add Course", exact: true })
  await expect(addCourse).toBeVisible({
    timeout: 30_000,
  })
}

vsCodeTest(
  "the Command Palette adds a course through its quick pick",
  async ({ page, webview }) => {
    const coursesView = new CoursesViewPage(page, webview)
    await coursesView.goto()
    await waitForActivation(page)

    await coursesView.runPaletteCommand("TestMyCode: Add Course")
    const quickPick = new QuickPickPage(page)
    await quickPick.waitForTitle("Add Course")
    await quickPick.selectByLabel("Test Organization")
    await quickPick.selectByLabel("Python Course")
    await quickPick.expectClosed()

    await new CourseHomePage(page, webview).expectShown("Python Course")
  },
)

vsCodeTest("dismissing the palette's add-course pick adds nothing", async ({ page, webview }) => {
  const coursesView = new CoursesViewPage(page, webview)
  await coursesView.goto()
  await waitForActivation(page)

  await coursesView.runPaletteCommand("TestMyCode: Add Course")
  const quickPick = new QuickPickPage(page)
  await quickPick.waitForTitle("Add Course")
  await quickPick.expectItem("Test Organization")
  await page.keyboard.press("Escape")

  await quickPick.expectClosed()
  await expect(coursesView.row("Python Course")).toBeHidden()
})
