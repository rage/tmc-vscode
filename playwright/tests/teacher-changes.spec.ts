import { expect } from "@playwright/test"

import { MOCK_BACKEND_URL } from "../../backend/mockSession"
import { passingExercise, pythonCourse } from "../../backend/mooc/fixtures"
import { vsCodeTest } from "../fixtures"
import { CourseHomePage } from "../pages/course-home"
import { CoursesViewPage } from "../pages/courses-view"
import { MoocLoginPage } from "../pages/mooc-login"

// What a teacher changes on the course shows in Course Details once its Refresh is pressed.
// backend/mooc republishes an exercise and changes the AI policy on request.

const COURSE_TITLE = "MOOC Python Course"

async function postToMock(path: string, body: object): Promise<void> {
  const response = await fetch(`${MOCK_BACKEND_URL}/mooc-mock/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  expect(response.status).toBe(204)
}

vsCodeTest(
  "Course Details' Refresh finds a changed exercise and a changed AI policy",
  async ({ page, webview }) => {
    const coursesView = new CoursesViewPage(page, webview)
    const courseHome = new CourseHomePage(page, webview)
    const toasts = await new MoocLoginPage(page, webview).recordToasts()

    await vsCodeTest.step("download the course's exercise", async () => {
      await coursesView.goto()
      await coursesView.addNewMoocCourse(COURSE_TITLE)
      await courseHome.downloadAll()
      await courseHome.expectState("passing_exercise", "Downloaded")
    })

    await vsCodeTest.step("a changed exercise shows after Refresh", async () => {
      await postToMock("publish-exercise-update", {
        exercise_id: passingExercise.slide.exercise_id,
      })

      await courseHome.refresh()

      // Updates install automatically by default, so the notice says it was updated.
      await expect(
        courseHome.notices().getByText(/^(Updated|1 update)$/, { exact: true }),
      ).toBeVisible({ timeout: 30_000 })
    })

    await vsCodeTest.step("a changed AI policy shows after Refresh", async () => {
      await postToMock("set-ai-policy", { course_id: pythonCourse.id, ai_policy: "no_ai" })

      await courseHome.refresh()

      await expect(courseHome.notices().getByText("AI policy changed")).toBeVisible({
        timeout: 30_000,
      })
      expect((await toasts()).filter((text) => /AI policy/.test(text))).toStrictEqual([])
    })
  },
)
