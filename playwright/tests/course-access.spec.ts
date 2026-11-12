import { expect } from "@playwright/test"

import { MOCK_BACKEND_URL } from "../../backend/mockSession"
import { pythonCourse } from "../../backend/mooc/fixtures"
import { vsCodeTest } from "../fixtures"
import { CourseHomePage } from "../pages/course-home"
import { CoursesViewPage } from "../pages/courses-view"
import { TmcPage } from "../pages/tmc"

// What Course Details says about a courses.mooc.fi course beyond its exercises: where its
// material is, and that the student is no longer enrolled on it. backend/mooc serves the course.

const COURSE_TITLE = "MOOC Python Course"

vsCodeTest(
  "Course Details links a mooc course and its exercises to their material",
  async ({ page, webview }) => {
    const coursesView = new CoursesViewPage(page, webview)
    const courseHome = new CourseHomePage(page, webview)

    await coursesView.goto()
    await coursesView.addNewMoocCourse(COURSE_TITLE)
    await courseHome.expectShown(COURSE_TITLE)

    const courseMenu = await courseHome.openMenu()
    await expect(courseMenu.getByRole("menuitem", { name: "Open Course Material" })).toBeVisible()
    await page.keyboard.press("Escape")

    const rowMenu = await courseHome.openMenu("More Actions for passing_exercise")
    await expect(rowMenu.getByRole("menuitem", { name: "Open in Course Material" })).toBeVisible()
  },
)

vsCodeTest(
  "Course Details says when the student is no longer enrolled on a mooc course",
  async ({ page, webview }) => {
    const coursesView = new CoursesViewPage(page, webview)
    const courseHome = new CourseHomePage(page, webview)
    const sidePanel = new TmcPage(page, webview).getSidePanel()
    const notice = courseHome.notices().getByText("You are not enrolled on this course")
    const code = page.locator(".monaco-editor").getByText("def hello()")

    await vsCodeTest.step("open the exercise in its course workspace", async () => {
      await coursesView.goto()
      await coursesView.addNewMoocCourse(COURSE_TITLE)
      await courseHome.expectShown(COURSE_TITLE)
      await courseHome.downloadAll()
      await courseHome.expectState("passing_exercise", "In workspace")
      await courseHome.openCourseWorkspace()
      await expect(page).toHaveTitle(/\(mooc\) \(Workspace\)/, { timeout: 30_000 })
      await courseHome.openExercise("passing_exercise")
      await expect(code).toBeVisible()
    })

    await vsCodeTest.step("a submission refused as not enrolled marks the course", async () => {
      expect((await setEnrolled(false)).status).toBe(204)
      await code.click()
      await page
        .getByRole("toolbar", { name: "Editor actions" })
        .getByLabel("Submit Solution", { exact: true })
        .click()
      await expect(sidePanel.getByRole("heading", { name: "Submission failed" })).toBeVisible()

      await expect(coursesView.row(COURSE_TITLE)).toHaveAccessibleName(/, not enrolled(,|$)/)

      // `webview` is the TestMyCode webview shown last, the result until it is closed.
      const submissionTab = page.getByRole("tab", { name: /^Submission: / })
      await submissionTab.click()
      await page.keyboard.press("Control+W")
      await expect(submissionTab).toBeHidden()
      await courseHome.reveal(COURSE_TITLE)
      await expect(notice).toBeVisible()
    })

    await vsCodeTest.step("enrolling again and refreshing clears it", async () => {
      expect((await setEnrolled(true)).status).toBe(204)
      await courseHome.refresh()

      await expect(notice).toBeHidden()
      await expect(coursesView.row(COURSE_TITLE)).not.toHaveAccessibleName(/not enrolled/)
    })
  },
)

function setEnrolled(enrolled: boolean): Promise<Response> {
  return fetch(`${MOCK_BACKEND_URL}/mooc-mock/set-enrolled`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ course_id: pythonCourse.id, enrolled }),
  })
}
