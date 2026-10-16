import { expect } from "@playwright/test"
import type { Locator, Page } from "@playwright/test"

import { VSCODE_TEST_VERSION } from "../../config"
import { vsCodeTest } from "../fixtures"
import { CoursesViewPage } from "../pages/courses-view"

const COURSE = "Python Course"
const FIRST_EXERCISE = "01_passing_exercise"
const SECOND_EXERCISE = "02_failing_exercise"
const MOOC_COURSE = "MOOC Python Course"
const MOOC_EXERCISE = "passing_exercise"
const RESTRICTED_MESSAGE = "This course workspace is in Restricted Mode"
const WORKSPACE_QUESTION = "Do you trust the authors of the files in this workspace?"
const FOLDER_QUESTION = "Do you trust the authors of the files in this folder?"

/**
 * Whether VS Code asks for trust on startup by itself: `security.workspace.trust.startupPrompt`
 * defaults to `once` before 1.137 and to `never` from it on.
 */
const isAskedOnStartup =
  VSCODE_TEST_VERSION !== "stable" &&
  VSCODE_TEST_VERSION.localeCompare("1.137.0", undefined, { numeric: true }) < 0

vsCodeTest.use({ isWorkspaceTrustEnabled: true })

function toast(page: Page, text: string | RegExp): Locator {
  return page.locator(".notifications-toasts .notification-toast").filter({ hasText: text })
}

function dialog(page: Page): Locator {
  return page.locator(".monaco-dialog-box")
}

/** Restricted Mode's indicator in the status bar. */
function restrictedModeIndicator(page: Page): Locator {
  return page.locator(".statusbar").getByText("Restricted Mode")
}

/** Answers the dialog asking `question` with its button `button`, and checks that it closed. */
async function answer(page: Page, question: string | RegExp, button: string): Promise<void> {
  const asking = dialog(page).filter({ hasText: question })
  await expect(asking).toBeVisible({ timeout: 30_000 })
  await asking.getByRole("button", { name: button, exact: true }).click()
  await expect(asking).toBeHidden()
}

/** Settles once the extension has asked VS Code for trust. */
function trustRequest(page: Page): Promise<unknown> {
  return page.waitForEvent("console", {
    predicate: (message) => message.text().includes("Requesting workspace trust."),
    timeout: 60_000,
  })
}

/**
 * Opens a course's workspace from the offer to, and answers each question about trusting it as it
 * opens untrusted: VS Code's own startup question where it asks one, else TestMyCode's and then
 * VS Code's.
 */
async function openCourseWorkspace(
  page: Page,
  courseTitle: string,
  isTrusted: boolean,
): Promise<void> {
  const requested = isAskedOnStartup ? trustRequest(page) : undefined
  // Unawaited until the question shows, so that a failure before then is the one reported.
  requested?.catch(() => undefined)
  const offer = toast(page, `The exercises of ${courseTitle} open in its course workspace.`)
  await offer.getByRole("button", { name: "Open Course Workspace" }).click()
  if (isAskedOnStartup) {
    await expect(dialog(page).filter({ hasText: WORKSPACE_QUESTION })).toBeVisible({
      timeout: 30_000,
    })
    // Answered once the extension's own request has joined it, which then asks nothing more.
    await requested
    await answer(
      page,
      WORKSPACE_QUESTION,
      isTrusted ? "Yes, I trust the authors" : "No, I don't trust the authors",
    )
  } else {
    const question = `Trust ${courseTitle} to run tests and submit`
    if (isTrusted) {
      await answer(page, question, "Trust Course Workspace")
      await answer(page, WORKSPACE_QUESTION, "Trust Workspace & Continue")
    } else {
      await answer(page, question, "Cancel")
    }
  }
  await expectNoFurtherDialog(page)
  await expect(restrictedModeIndicator(page)).toBeVisible({ visible: !isTrusted })
}

/** Checks that no further dialog comes up, as a late request would show a second one. */
async function expectNoFurtherDialog(page: Page): Promise<void> {
  // oxlint-disable-next-line playwright/no-wait-for-timeout -- only waiting out the extension's wait for VS Code's startup question shows that no second one follows
  await page.waitForTimeout(4000)
  await expect(dialog(page)).toBeHidden()
}

vsCodeTest(
  "a course workspace asks for trust as it opens, and again for each exercise downloaded in it",
  async ({ page, webview }) => {
    const coursesView = new CoursesViewPage(page, webview)

    await vsCodeTest.step("open the course workspace and trust it", async () => {
      await coursesView.goto()
      await coursesView.addNewCourse(COURSE)
      await coursesView.expand(coursesView.row(COURSE))
      await coursesView.runInlineAction(coursesView.row(FIRST_EXERCISE), "Download")
      await openCourseWorkspace(page, COURSE, true)
    })

    await vsCodeTest.step("a newly downloaded exercise asks for trust of its own", async () => {
      await coursesView.goto()
      await coursesView.expand(coursesView.row(COURSE))
      await coursesView.runInlineAction(coursesView.row(SECOND_EXERCISE), "Download")
      await answer(page, FOLDER_QUESTION, "Yes")
      await expect(coursesView.row(SECOND_EXERCISE)).toHaveAccessibleName(/, open,/)
      await page.keyboard.press("Control+Shift+E")
      await expect(
        page.locator(".explorer-folders-view").getByText(new RegExp(`${SECOND_EXERCISE}$`)),
      ).toBeVisible()
      await expect(restrictedModeIndicator(page)).toBeHidden()
    })

    await vsCodeTest.step("runs tests without a reload", async () => {
      await coursesView.goto()
      await coursesView.runInlineAction(coursesView.row(FIRST_EXERCISE), "Run Tests")
      await expect(toast(page, /All tests of \S*01_passing_exercise passed\./)).toBeVisible()
    })

    await vsCodeTest.step("a second course's workspace asks again", async () => {
      await coursesView.goto()
      await coursesView.addNewMoocCourse(MOOC_COURSE)
      await coursesView.expand(coursesView.row(MOOC_COURSE))
      await coursesView.runContextMenuCommand(coursesView.row(MOOC_EXERCISE), "Open")
      await openCourseWorkspace(page, MOOC_COURSE, true)
      // The window reloaded into the course workspace, named after its file.
      await expect(page).toHaveTitle(/\(mooc\)/)
      await coursesView.goto()
      await coursesView.expand(coursesView.row(MOOC_COURSE))
      await coursesView.runInlineAction(coursesView.row(MOOC_EXERCISE), "Run Tests")
      await expect(toast(page, /All tests of \S*passing_exercise passed\./)).toBeVisible()
    })
  },
)

vsCodeTest(
  "a course workspace left untrusted keeps the Courses view, and asks again on Run Tests",
  async ({ page, webview }) => {
    const coursesView = new CoursesViewPage(page, webview)

    await vsCodeTest.step("open the course workspace and decline to trust it", async () => {
      await coursesView.goto()
      await coursesView.addNewCourse(COURSE)
      await coursesView.expand(coursesView.row(COURSE))
      await coursesView.runInlineAction(coursesView.row(FIRST_EXERCISE), "Download")
      await openCourseWorkspace(page, COURSE, false)
    })

    await vsCodeTest.step("Restricted Mode keeps the Courses view, and says why", async () => {
      await coursesView.goto()
      await expect(page.getByText(RESTRICTED_MESSAGE)).toBeVisible()
      await coursesView.expand(coursesView.row(COURSE))
      await expect(coursesView.row(FIRST_EXERCISE)).toHaveAccessibleName(/, open,/)
    })

    await vsCodeTest.step("Run Tests asks for trust, and runs once trusted", async () => {
      await coursesView.runInlineAction(coursesView.row(FIRST_EXERCISE), "Run Tests")
      const refusal = toast(page, RESTRICTED_MESSAGE)
      await refusal.getByRole("button", { name: "Trust Course Workspace" }).click()
      await answer(page, WORKSPACE_QUESTION, "Trust Workspace & Continue")
      await expect(toast(page, /All tests of \S*01_passing_exercise passed\./)).toBeVisible()
      await expect(restrictedModeIndicator(page)).toBeHidden()
    })
  },
)
