import { expect } from "@playwright/test"

import { MOCK_BACKEND_URL } from "../../backend/mockSession"
import { pythonCourse } from "../../backend/mooc/fixtures"
import { vsCodeTest } from "../fixtures"
import { CourseHomePage } from "../pages/course-home"
import { CoursesViewPage } from "../pages/courses-view"
import { TmcPage } from "../pages/tmc"

// What Course Details says about a courses.mooc.fi course beyond its exercises: where its
// material is, and that the student is no longer enrolled on it or can no longer reach it at
// all. backend/mooc serves the course.

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
      await courseHome.expectState("passing_exercise", "Downloaded")
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
      const submissionTab = page.getByRole("tab", { name: /^Results: / })
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

vsCodeTest(
  "Course Details says when a mooc course can no longer be reached, and removes it",
  async ({ page, webview }) => {
    const coursesView = new CoursesViewPage(page, webview)
    const courseHome = new CourseHomePage(page, webview)
    const noAccess = courseHome.notices().getByText("You no longer have access to this course")
    const gone = courseHome.notices().getByText("This course no longer exists on courses.mooc.fi")

    await vsCodeTest.step("download the course's exercises", async () => {
      await coursesView.goto()
      await coursesView.addNewMoocCourse(COURSE_TITLE)
      await courseHome.expectShown(COURSE_TITLE)
      await courseHome.downloadAll()
      await courseHome.expectState("passing_exercise", "Downloaded")
    })

    await vsCodeTest.step(
      "a course closed to students says so and offers nothing to download",
      async () => {
        expect((await setCourseAccess("forbidden")).status).toBe(204)
        await courseHome.refresh()

        await expect(noAccess).toBeVisible()
        await expect(
          courseHome.notices().getByRole("button", { name: "Find the Course on courses.mooc.fi" }),
        ).toBeVisible()
        await expect(courseHome.webview.getByRole("button", { name: /^Download/ })).toHaveCount(0)
        await expect(courseHome.row("passing_exercise")).toContainText("no access")
        await expect(coursesView.row(COURSE_TITLE)).toHaveAccessibleName(/, no access(,|$)/)
      },
    )

    await vsCodeTest.step("access back, a refresh clears it", async () => {
      expect((await setCourseAccess("open")).status).toBe(204)
      await courseHome.refresh()

      await expect(noAccess).toBeHidden()
      await expect(coursesView.row(COURSE_TITLE)).not.toHaveAccessibleName(/no access/)
    })

    await vsCodeTest.step("a deleted course can be removed from its notice", async () => {
      expect((await setCourseAccess("deleted")).status).toBe(204)
      await courseHome.refresh()
      await expect(gone).toBeVisible()
      await expect(coursesView.row(COURSE_TITLE)).toHaveAccessibleName(/, removed(,|$)/)

      await courseHome.notices().getByRole("button", { name: "Remove Course" }).click()
      await page
        .locator(".monaco-dialog-box")
        .getByRole("button", { name: "Remove Course", exact: true })
        .click()

      await expect(courseHome.heading(COURSE_TITLE)).toBeHidden()
      await expect(coursesView.row(COURSE_TITLE)).toHaveCount(0)
    })
  },
)

function setCourseAccess(access: "open" | "forbidden" | "deleted"): Promise<Response> {
  return fetch(`${MOCK_BACKEND_URL}/mooc-mock/set-course-access`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ course_id: pythonCourse.id, access }),
  })
}

function setEnrolled(enrolled: boolean): Promise<Response> {
  return fetch(`${MOCK_BACKEND_URL}/mooc-mock/set-enrolled`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ course_id: pythonCourse.id, enrolled }),
  })
}
