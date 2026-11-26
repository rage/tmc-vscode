import * as fs from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"

import { expect, test } from "@playwright/test"
import type { FrameLocator, Page, TestInfo } from "@playwright/test"

import { closeElectron, resetMockBackend, tmcWebview } from "../fixtures"
import { CoursesViewPage } from "../pages/courses-view"
import type { Profile } from "./installedExtension"
import {
  createProfile,
  installVsix,
  launchVsCode,
  legacyVsix,
  NEXT_VSIX,
  ROLLBACK_VSIX,
  PINNED_LANGS_VERSION,
  readGlobalState,
} from "./installedExtension"
import { LegacyTmcPage } from "./legacyPages"

const PYTHON_COURSE = { title: "Python Course", name: "python-course" }
const JAVA_COURSE = { title: "Java Course", name: "java-course" }
// Both versions label an exercise without its part prefix.
const OPENED_EXERCISE = { label: "01_passing_exercise", slug: "part01-01_passing_exercise" }
const CLOSED_EXERCISE = { label: "02_failing_exercise", slug: "part01-02_failing_exercise" }
const EDITED_FILE = ["src", "passing_exercise.py"]
const STUDENT_EDIT = "# kept across the upgrade\n"

interface Session {
  page: Page
  /** The extension's webview, for the 4.x page objects. */
  webview: FrameLocator
}

/**
 * Runs `run` against VS Code started on `profile`, then closes it. A failing `phase` leaves its
 * trace behind, named after it.
 */
async function withVsCode(
  profile: Profile,
  phase: string,
  testInfo: TestInfo,
  run: (session: Session) => Promise<void>,
): Promise<void> {
  const vsCode = await launchVsCode(profile)
  await vsCode.context().tracing.start({ screenshots: true, snapshots: true })
  let isFailed = true
  try {
    const page = await vsCode.firstWindow()
    await run({ page, webview: tmcWebview(page) })
    isFailed = false
  } finally {
    await vsCode
      .context()
      .tracing.stop(isFailed ? { path: testInfo.outputPath(`${phase}-trace.zip`) } : {})
      .catch(() => undefined)
    await closeElectron(vsCode)
  }
}

/** The one copy of `exercise` under the projects dir, wherever this langs version keeps it. */
function exerciseDir(profile: Profile, exercise: string): string | undefined {
  const matches = fs
    .readdirSync(profile.projectsDir, { recursive: true, encoding: "utf8" })
    .filter((entry) => basename(entry) === exercise)
  expect(matches.length, `copies of ${exercise}: ${matches.join(", ")}`).toBeLessThanOrEqual(1)
  return matches[0] && join(profile.projectsDir, matches[0])
}

function expectEditKept(editedFile: string): void {
  expect(fs.readFileSync(editedFile, "utf8")).toContain(STUDENT_EDIT)
}

async function expectNoErrorNotification(page: Page): Promise<void> {
  await expect(page.locator(".notifications-toasts .codicon-error")).toHaveCount(0)
}

/**
 * What 4.x must show of the 3.5.5 profile: its courses and session, and with `isExerciseChecked`
 * the downloaded exercises and their states.
 */
async function expectKeptBy4x(
  { page, webview }: Session,
  courses: string[],
  isExerciseChecked: boolean,
): Promise<void> {
  const coursesView = new CoursesViewPage(page, webview)
  await coursesView.goto()
  for (const course of courses) {
    await expect(coursesView.row(course)).toBeVisible()
  }
  // 3.5.5 logged in with a tmc.mooc.fi password, which 4.x keeps as a legacy login.
  await expect(
    page
      .locator('[id="workbench.parts.statusbar"]')
      .getByRole("button", { name: /logged in with an old tmc\.mooc\.fi login/ }),
  ).toBeVisible()

  if (isExerciseChecked) {
    await coursesView.expand(coursesView.row(PYTHON_COURSE.title))
    await coursesView.expand(coursesView.row("Part 1"))
    await expect(coursesView.row(OPENED_EXERCISE.label)).toHaveAccessibleName(
      /, (downloaded|in workspace),/,
    )
    await expect(coursesView.row(CLOSED_EXERCISE.label)).toHaveAccessibleName(/, closed,/)

    await coursesView.row(OPENED_EXERCISE.label).click()
    await expect(page.getByRole("tab", { name: /passing_exercise\.py/ })).toBeVisible()
    await expect(page.locator(".monaco-editor .view-lines").first()).toContainText(
      STUDENT_EDIT.trim(),
    )
  }

  await expect(page.getByText("Get Started with TestMyCode")).toHaveCount(0)
  await expectNoErrorNotification(page)
}

/** What 3.5.5 must still show after 4.x ran: its course and session, and maybe its exercises. */
async function expectKeptBy355(legacy: LegacyTmcPage, isExerciseChecked: boolean): Promise<void> {
  await legacy.openCourse(PYTHON_COURSE.title, PYTHON_COURSE.name)
  await expect(legacy.menuItem("Log out")).toBeVisible()
  if (isExerciseChecked) {
    await legacy.showExercises()
    await expect(legacy.exerciseStatus(OPENED_EXERCISE.label)).toHaveText("opened")
    await expect(legacy.exerciseStatus(CLOSED_EXERCISE.label)).toHaveText("closed")
  }
  await expectNoErrorNotification(legacy.page)
}

/** Upgrades a 3.5.5 profile with a course and edited exercises to 4.x, back, and up again. */
async function runUpgradeScenario(
  testInfo: TestInfo,
  { isExerciseChecked }: { isExerciseChecked: boolean },
): Promise<void> {
  expect(fs.existsSync(NEXT_VSIX), `${NEXT_VSIX} is missing; run bin/packageUpgradeVsix.sh`).toBe(
    true,
  )
  const parentDir = fs.mkdtempSync(join(tmpdir(), "tmc-vscode-upgrade-"))
  const profile = createProfile(parentDir)

  try {
    await resetMockBackend("tmc")
    await installVsix(profile, await legacyVsix())

    const editedFile =
      await test.step("3.5.5: log in, add a course, download, edit and close", async () => {
        await withVsCode(profile, "legacy", testInfo, async ({ page }) => {
          const legacy = new LegacyTmcPage(page)
          await legacy.logIn()
          await legacy.addCourse(PYTHON_COURSE.title, PYTHON_COURSE.name)
          await legacy.openCourse(PYTHON_COURSE.title, PYTHON_COURSE.name)
          await legacy.showExercises()
          await legacy.downloadAndOpenAll([OPENED_EXERCISE.label, CLOSED_EXERCISE.label])
          await legacy.closeExercise(CLOSED_EXERCISE.label)
          await expect(legacy.exerciseStatus(OPENED_EXERCISE.label)).toHaveText("opened")
        })
        // Tells a 3.5.5 that never saved its courses apart from a 4.x that did not read them.
        expect(readGlobalState(profile)).toHaveProperty(
          ["user-data-v1", "courses", "0", "name"],
          PYTHON_COURSE.name,
        )
        const dir = exerciseDir(profile, OPENED_EXERCISE.slug)
        expect(dir).toBeDefined()
        const file = join(dir ?? "", ...EDITED_FILE)
        fs.appendFileSync(file, STUDENT_EDIT)
        return file
      })

    await test.step("upgrade: 3.5.5's data is kept, and stays readable by 3.5.5", async () => {
      await installVsix(profile, NEXT_VSIX)
      await withVsCode(profile, "upgrade", testInfo, (session) =>
        expectKeptBy4x(session, [PYTHON_COURSE.title], isExerciseChecked),
      )
      expectEditKept(editedFile)
      const globalState = readGlobalState(profile)
      expect(globalState).toHaveProperty(["user-data-v1"])
      expect(globalState).toHaveProperty(["user-data-v3"])
    })

    // Straight after 4.x, where users get it: it imports 4.x's data over `user-data-v1` once.
    await test.step("rollback build: reads the profile 4.x used", async () => {
      expect(
        fs.existsSync(ROLLBACK_VSIX),
        `${ROLLBACK_VSIX} is missing; run bin/packageRollbackVsix.sh`,
      ).toBe(true)
      await installVsix(profile, ROLLBACK_VSIX)
      await withVsCode(profile, "rollback", testInfo, async ({ page }) => {
        const legacy = new LegacyTmcPage(page)
        await expectKeptBy355(legacy, isExerciseChecked)
      })
      expectEditKept(editedFile)
    })

    await test.step("downgrade: 3.5.5 still has it, and adds a course", async () => {
      await installVsix(profile, await legacyVsix())
      await withVsCode(profile, "downgrade", testInfo, async ({ page }) => {
        const legacy = new LegacyTmcPage(page)
        await expectKeptBy355(legacy, isExerciseChecked)
        await legacy.addCourse(JAVA_COURSE.title, JAVA_COURSE.name)
      })
      expectEditKept(editedFile)
    })

    await test.step("re-upgrade: nothing is lost, and the course 3.5.5 added shows", async () => {
      await installVsix(profile, NEXT_VSIX)
      await withVsCode(profile, "re-upgrade", testInfo, (session) =>
        expectKeptBy4x(session, [PYTHON_COURSE.title, JAVA_COURSE.title], isExerciseChecked),
      )
      expectEditKept(editedFile)
    })
  } finally {
    // Windows refuses to delete files a just-killed CLI process still holds for a moment.
    fs.rmSync(parentDir, { recursive: true, force: true, maxRetries: 5 })
  }
}

test.describe(() => {
  test.describe.configure({ timeout: 10 * 60_000 })

  test("a 3.5.5 user keeps their courses and session across upgrade and downgrade", async ({}, testInfo) => {
    await runUpgradeScenario(testInfo, { isExerciseChecked: false })
  })

  test("a 3.5.5 user keeps their downloaded exercises across upgrade and downgrade", async ({}, testInfo) => {
    test.fail(
      PINNED_LANGS_VERSION === "0.42.1",
      "tmc-langs 0.42.1 drops exercises 0.39.9 downloaded from course_config.toml; 0.42.2 keeps them",
    )
    await runUpgradeScenario(testInfo, { isExerciseChecked: true })
  })
})
