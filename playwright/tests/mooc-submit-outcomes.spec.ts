import { expect } from "@playwright/test"
import type { Locator, Page } from "@playwright/test"

import { MOCK_BACKEND_URL } from "../../backend/mockSession"
import { failingExercise, passingExercise, pythonCourse } from "../../backend/mooc/fixtures"
import { vsCodeTest } from "../fixtures"
import { CoursesViewPage } from "../pages/courses-view"
import { TmcPage } from "../pages/tmc"

vsCodeTest.use({ isCoursesMoocFiEnabled: true })

// What a student sees when a submission does not simply pass, or the backend does not answer.
// Each case drives backend/mooc/router.ts through its /mooc-mock controls.

const postMock = async (route: string, body?: unknown): Promise<void> => {
  const res = await fetch(`${MOCK_BACKEND_URL}/${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  })
  expect(res.status, route).toBe(204)
}

const setOutcome = (exerciseId: string, outcome: string | null): Promise<void> =>
  postMock("mooc-mock/set-grading-outcome", { exercise_id: exerciseId, outcome })

const failNext = (operationId: string, status: number): Promise<void> =>
  postMock("mooc-mock/fail-next", { operationId, status })

/**
 * Waits until `message` shows as a toast or in the side panel. The two live in different frames,
 * which one composite locator cannot span.
 */
async function expectReported(tmc: TmcPage, message: RegExp): Promise<void> {
  const sidePanel = tmc.getSidePanel()
  await expect
    .poll(
      async () => {
        const inPanel = await sidePanel
          .getByText(message)
          .count()
          .catch(() => 0)
        return inPanel + (await tmc.notificationToast(message).count())
      },
      { timeout: 30_000, message: `${message.source} was not reported` },
    )
    .toBeGreaterThan(0)
}

const submitButton = (page: Page): Locator =>
  page.getByRole("toolbar", { name: "Editor actions" }).getByLabel("Submit", { exact: true })

/**
 * A course with no AI policy is submitted from its course workspace only; a policy that allows AI
 * lets the exercise submit from wherever it is open.
 */
const allowAiIn = (courseId: string): Promise<void> =>
  postMock("mooc-mock/set-ai-policy", { course_id: courseId, ai_policy: "full_use" })

/** Adds `course`, downloads `exercise` and leaves its source file focused. */
async function openExercise(
  page: Page,
  coursesView: CoursesViewPage,
  course: string,
  exercise: string,
): Promise<void> {
  await allowAiIn(pythonCourse.id)
  await coursesView.goto()
  await coursesView.addNewMoocCourse(course)
  await coursesView.expand(coursesView.row(course))
  const row = coursesView.row(exercise)
  await row.click()
  await expect(row).toHaveAccessibleName(/, (downloaded|in workspace),/)
  await page.locator(".monaco-editor").first().click()
}

vsCodeTest(
  "a compile error is a graded failure that shows the server's output",
  async ({ page, webview }) => {
    const coursesView = new CoursesViewPage(page, webview)
    const sidePanel = new TmcPage(page, webview).getSidePanel()
    await setOutcome(failingExercise.slide.exercise_id, "compileFailed")

    await openExercise(page, coursesView, "MOOC Extra Course", "failing_exercise")
    await submitButton(page).click()

    await expect(sidePanel.getByText("Your code did not compile on the server.")).toBeVisible()
    await expect(sidePanel.getByText("SyntaxError: invalid syntax")).toBeVisible()
  },
)

vsCodeTest(
  "a run that could not be graded is reported as failed, not as a wrong answer",
  async ({ page, webview }) => {
    const coursesView = new CoursesViewPage(page, webview)
    const sidePanel = new TmcPage(page, webview).getSidePanel()
    await setOutcome(failingExercise.slide.exercise_id, "genericError")

    await openExercise(page, coursesView, "MOOC Extra Course", "failing_exercise")
    await submitButton(page).click()

    await expect(
      sidePanel.getByRole("heading", { name: "Grading failed", exact: true }),
    ).toBeVisible()
    await expect(sidePanel.getByText("The tests could not be run on the server.")).toBeVisible()
  },
)

vsCodeTest(
  "a failed submission, an edit, and a passing one on one exercise",
  async ({ page, webview }) => {
    const coursesView = new CoursesViewPage(page, webview)
    const sidePanel = new TmcPage(page, webview).getSidePanel()
    await setOutcome(passingExercise.slide.exercise_id, "failing")

    await openExercise(page, coursesView, "MOOC Python Course", "passing_exercise")
    await submitButton(page).click()
    await expect(sidePanel.getByRole("heading", { name: "Not passed", exact: true })).toBeVisible()

    await setOutcome(passingExercise.slide.exercise_id, null)
    await page.locator(".monaco-editor").first().click()
    await page.keyboard.type("# fixed\n")
    await submitButton(page).click()

    await expect(sidePanel.getByRole("heading", { name: "Passed", exact: true })).toBeVisible()
  },
)

for (const [status, message] of [
  [500, /server|try again/i],
  [429, /too many|try again|wait/i],
  [426, /update|outdated|obsolete|upgrade/i],
] as const) {
  vsCodeTest(
    `a ${status} answer to a submit is reported, and the next submit goes through`,
    async ({ page, webview }) => {
      const coursesView = new CoursesViewPage(page, webview)
      const tmc = new TmcPage(page, webview)
      const sidePanel = tmc.getSidePanel()
      await openExercise(page, coursesView, "MOOC Python Course", "passing_exercise")

      await failNext("submitClientExercise", status)
      await submitButton(page).click()
      await expectReported(tmc, message)

      await submitButton(page).click()
      await expect(sidePanel.getByRole("heading", { name: "Passed", exact: true })).toBeVisible()
    },
  )
}

vsCodeTest(
  "a deadline that passes between download and submit refuses the submit",
  async ({ page, webview }) => {
    const coursesView = new CoursesViewPage(page, webview)
    const tmc = new TmcPage(page, webview)
    const chapter = {
      id: "c0c0c0c0-0000-4000-8000-000000000009",
      name: "Loops",
      chapter_number: 1,
    }
    await postMock("mooc-mock/set-exercise-chapter", {
      exercise_id: passingExercise.slide.exercise_id,
      chapter: { ...chapter, deadline: "2100-01-01T00:00:00.000Z" },
    })
    await openExercise(page, coursesView, "MOOC Python Course", "passing_exercise")

    await postMock("mooc-mock/set-exercise-chapter", {
      exercise_id: passingExercise.slide.exercise_id,
      chapter: { ...chapter, deadline: "2000-01-01T00:00:00.000Z" },
    })
    await submitButton(page).click()

    await expectReported(tmc, /deadline/i)
  },
)

vsCodeTest(
  "an unreachable backend fails a submit, and the next one succeeds",
  async ({ page, webview }) => {
    const coursesView = new CoursesViewPage(page, webview)
    const tmc = new TmcPage(page, webview)
    const sidePanel = tmc.getSidePanel()
    await openExercise(page, coursesView, "MOOC Python Course", "passing_exercise")

    await postMock("mooc-mock/set-connections-dropped", { dropped: true })
    await submitButton(page).click()
    await expectReported(tmc, /connect|reach|network|offline/i)

    await postMock("mooc-mock/set-connections-dropped", { dropped: false })
    await submitButton(page).click()
    await expect(sidePanel.getByRole("heading", { name: "Passed", exact: true })).toBeVisible()
  },
)
