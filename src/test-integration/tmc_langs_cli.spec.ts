import * as cp from "child_process"
import { createHash } from "crypto"
import * as os from "os"
import * as path from "path"

import { expect } from "chai"
import { deleteSync } from "del"
import * as fs from "fs-extra"
import { first } from "lodash"
import kill from "tree-kill"
import type { Result } from "ts-results"

import {
  CLIENT_CONFIG_DIR_NAME,
  MOCK_BACKEND_URL,
  MOCK_INVALID_REFRESH_TOKEN,
  MOCK_SEEDED_ACCESS_TOKEN,
  MOCK_SEEDED_REFRESH_TOKEN,
  mockUserCode,
  tmcCredentials,
} from "../../backend/mockSession"
import { MOCK_DEFAULT_USER_ID, TMC_ARCHIVE_MIME } from "../../backend/mooc/fixtures"
import type {
  ExerciseSlideSubmissionListItem,
  ExerciseTaskSubmissionStatus,
  Submission,
  SubmissionFeedback,
} from "../../shared/langsSchema"
import { makeMoocKind, makeTmcKind } from "../../shared/lib"
import Langs from "../api/langs"
import { CLIENT_NAME, MINIMUM_SUBMISSION_INTERVAL, TMC_LANGS_VERSION } from "../config/constants"
import {
  AuthorizationError,
  ChapterLockedError,
  DeadlinePassedError,
  DeviceLoginExpiredError,
  ExerciseNotFoundError,
  InsufficientScopeError,
  InvalidTokenError,
  NotEnrolledError,
  NotFoundError,
  OutOfTriesError,
  ExerciseLockedError,
  RateLimitedError,
  RuntimeError,
} from "../errors"
import { idOfMoocCourse, idOfMoocExercise, idOfTmcExercise } from "../test/fixtures/identifiers"
import { getLangsCLIForPlatform, getPlatform } from "../utilities"

// __dirname is the dist folder when built.
const PROJECT_ROOT = path.join(__dirname, "..")
const ARTIFACT_ROOT = path.join(PROJECT_ROOT, "test-artifacts")

// Use CLI from backend folder to run tests.
const BACKEND_FOLDER = path.join(PROJECT_ROOT, "backend")
const CLI_PATH = path.join(BACKEND_FOLDER, "cli")
const CLI_FILE = path.join(CLI_PATH, getLangsCLIForPlatform(getPlatform(), TMC_LANGS_VERSION))
const FEEDBACK_URL = `${MOCK_BACKEND_URL}/feedback`

const isString = (object: unknown): object is string => typeof object === "string"

/** Makes the mooc mock's tokens act for the account `id`. */
const setCurrentUser = (id: string): Promise<Response> =>
  fetch(`${MOCK_BACKEND_URL}/mooc-mock/set-current-user`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id }),
  })

/** Puts the exercise in a chapter for `run`, as a teacher can, and takes it out after. */
const inChapter = async <T>(
  exerciseId: string,
  chapter: { opens_at?: string; locking_status?: string; deadline?: string },
  run: () => Promise<T>,
): Promise<T> => {
  const setChapter = (value: unknown): Promise<Response> =>
    fetch(`${MOCK_BACKEND_URL}/mooc-mock/set-exercise-chapter`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ exercise_id: exerciseId, chapter: value }),
    })
  const set = await setChapter({
    id: "c0c0c0c0-0000-4000-8000-000000000009",
    name: "Recursion",
    chapter_number: 3,
    ...chapter,
  })
  expect(set.status).to.equal(204)
  try {
    return await run()
  } finally {
    await setChapter(null)
  }
}

suite("tmc langs cli spec", function () {
  let server: cp.ChildProcess | undefined
  let runArtifactDir: string
  let anyTestFailed = false

  suiteSetup(async function () {
    this.timeout(30000)
    // Per run: credentials an earlier run left behind would be adopted over the ones a case seeds.
    fs.mkdirSync(ARTIFACT_ROOT, { recursive: true })
    runArtifactDir = fs.mkdtempSync(path.join(ARTIFACT_ROOT, "run-"))
    // Routes mooc CLI calls at the mock in the same backend process (backend/mooc), overriding the
    // MOOC_BACKEND_URL define. Must be set before any Langs is constructed.
    process.env.TMC_LANGS_MOOC_ROOT_URL = MOCK_BACKEND_URL
    // Without this the CLI attaches no bearer to localhost, and both backends need one.
    process.env.TMC_LANGS_MOOC_TRUST_LOCALHOST = "1"
    server = await startServer()
  })

  let testDir: string
  let testIndex = 0

  setup(function () {
    const fullTitle = this.currentTest?.fullTitle()
    if (!fullTitle) {
      throw new Error("Illegal function call.")
    }
    testIndex++
    // Digested, not truncated: titles sharing head and tail would collide, and cases sharing a
    // directory share credentials and a projects dir.
    const titleDigest = createHash("sha256").update(fullTitle).digest("hex").slice(0, 8)
    testDir = path.join(runArtifactDir, `${testIndex}-${titleDigest}`)
  })

  teardown(function () {
    if (this.currentTest?.state === "failed") {
      anyTestFailed = true
    }
  })

  test("the shared client config dir name is the one langs derives from CLIENT_NAME", function () {
    expect(CLIENT_CONFIG_DIR_NAME).to.equal(`tmc-${CLIENT_NAME}`)
  })

  // A pre-existing tmc token in credentials.json: still supported, though no longer created.
  suite("authenticated user", function () {
    let configDir: string
    let onLoggedOutCalls: number
    let projectsDir: string
    let tmc: Langs

    setup(function () {
      configDir = path.join(testDir, CLIENT_CONFIG_DIR_NAME)
      writeCredentials(configDir)
      onLoggedOutCalls = 0
      projectsDir = setupProjectsDir(configDir, path.join(testDir, "tmcdata"))
      tmc = new Langs(CLI_FILE, CLIENT_NAME, "test", {
        cliConfigDir: testDir,
      })
      tmc.on("logout", () => onLoggedOutCalls++)
    })

    test("should be able to deauthenticate", async function () {
      await unwrapResult(tmc.deauthenticate())
      expect(onLoggedOutCalls).to.be.equal(1)

      const result = await unwrapResult(tmc.isAuthenticated())
      expect(result).to.be.false
    })

    // A backend-rejected token ends a session too: the CLI deletes the credential, so the extension
    // must be told. Not get-course-data: its LangsError wrapping hides the 401 the CLI otherwise
    // turns into invalid-token (see "should not get existing api data in general").
    test("reports a logout when the backend rejects the stored token", async function () {
      writeCredentials(configDir, "no-longer-accepted")

      const result = await tmc.getCourses("test")
      expect(result.val).to.be.instanceOf(InvalidTokenError)
      expect(onLoggedOutCalls).to.be.equal(1)
      expect(fs.existsSync(path.join(configDir, "credentials.json"))).to.be.false
    })

    test("should be able to read and change settings", async function () {
      const key = "test-value"

      const result1 = await unwrapResult(tmc.getSetting(key, isString))
      expect(result1).to.be.undefined

      await unwrapResult(tmc.setSetting(key, "yes no yes yes"))
      const result2 = await unwrapResult(tmc.getSetting(key, isString))
      expect(result2).to.be.equal("yes no yes yes")

      await unwrapResult(tmc.unsetSetting(key))
      const result3 = await unwrapResult(tmc.getSetting(key, isString))
      expect(result3).to.be.undefined

      await unwrapResult(tmc.setSetting(key, "foo bar biz baz"))
      await unwrapResult(tmc.resetSettings())
      const result4 = await unwrapResult(tmc.getSetting(key, isString))
      expect(result4).to.be.undefined
    })

    test("should be able to download an existing exercise", async function () {
      await unwrapResult(tmc.downloadTmcExercises([1], true, () => {}))
    }).timeout(10000)

    // Ids missing from the server are missing from the response.
    test.skip("should not be able to download a non-existent exercise", async function () {
      const downloads = await unwrapResult(tmc.downloadTmcExercises([404], true, () => {}))
      expect(downloads.failed.length).to.be.equal(1)
    })

    test("should get existing api data", async function () {
      const data = (await tmc.getTmcCourseData(1)).unwrap()
      expect(data.details.name).to.be.equal("python-course")
      expect(data.exercises.length).to.be.equal(2)
      expect(data.settings.name).to.be.equal("python-course")

      const courses = (await tmc.getCourses("test")).unwrap()
      expect(courses.length).to.be.equal(2)
      expect(courses.some((x) => x.name === "python-course")).to.be.true

      const submissions = (await tmcSubmissions(tmc, 1)).unwrap()
      expect(submissions.length).to.be.greaterThan(0)

      const organizations = (await tmc.getTmcOrganizations()).unwrap()
      expect(organizations.length).to.be.equal(1, "Expected to get one organization.")
    })

    test("should encounter errors when trying to get non-existing api data", async function () {
      const dataResult = await tmc.getTmcCourseData(404)
      expect(dataResult.val).to.be.instanceOf(RuntimeError)

      const coursesResult = await tmc.getCourses("404")
      expect(coursesResult.val).to.be.instanceOf(NotFoundError)

      const submissionsResult = await tmcSubmissions(tmc, 404)
      expect(submissionsResult.val).to.be.instanceOf(ExerciseNotFoundError)
    })

    test("should be able to give feedback", async function () {
      const feedback: SubmissionFeedback = {
        status: [{ question_id: 0, answer: "42" }],
      }
      await unwrapResult(tmc.submitSubmissionFeedback(FEEDBACK_URL, feedback))
    })

    suite("with a local exercise", function () {
      this.timeout(20000)

      let exercisePath: string

      setup(async function () {
        deleteSync(projectsDir, { force: true })
        const tmcRes = await unwrapResult(tmc.downloadTmcExercises([1], true, () => {}))
        const downloaded = tmcRes.downloaded[0]
        if (!downloaded) {
          throw new Error("expected an exercise to have been downloaded")
        }
        exercisePath = downloaded.path
      })

      test("should be able to clean the exercise", async function () {
        await unwrapResult(tmc.clean(exercisePath))
      })

      test("should be able to list local exercises", async function () {
        const result = (await unwrapResult(tmc.listLocalExercises())).filter(
          (x) => x.backend === "tmc" && x["course-slug"] === "python-course",
        )
        expect(result.length).to.be.equal(1)
        expect(first(result)?.["exercise-path"]).to.be.equal(exercisePath)
      })

      test("should be able to run tests for exercise", async function () {
        const result = await unwrapResult(tmc.runTests(exercisePath).process)
        expect(result.status).to.be.equal("PASSED")
      })

      test("should be able to migrate the exercise to langs projects directory", async function () {
        // The exercise is gone from the new projects directory, so it can be "migrated".
        projectsDir = setupProjectsDir(configDir, path.join(testDir, "tmcdata2"))
        fs.emptyDirSync(projectsDir)
        await unwrapResult(
          tmc.migrateExercise("python-course", "abc123", 1, exercisePath, "hello-world"),
        )
      })

      test("should be able to move projects directory", async function () {
        const newProjectsDir = path.resolve(projectsDir, "..", "tmcdata2")
        fs.emptyDirSync(newProjectsDir)
        await unwrapResult(tmc.moveProjectsDirectory(newProjectsDir))
      })

      test("should be able to check for exercise updates", async function () {
        const result = await unwrapResult(tmc.checkExerciseUpdates("tmc"))
        expect(result).to.deep.equal({ updated: [], removed: [] })
      })

      test("should be able to save the exercise state and revert it to an old submission", async function () {
        const submissions = await unwrapResult(tmcSubmissions(tmc, 1))
        await unwrapResult(
          tmc.restoreSubmission(
            makeTmcKind({ exerciseId: 1, submissionId: 1 }),
            exercisePath,
            true,
          ),
        )

        // State saving check is based on a side effect of making a new submission.
        const newSubmissions = await unwrapResult(tmcSubmissions(tmc, 1))
        expect(newSubmissions.length).to.be.equal(submissions.length + 1)
      })

      test("should be able to download an old submission without saving the current state", async function () {
        const submissions = await unwrapResult(tmcSubmissions(tmc, 1))
        await unwrapResult(
          tmc.restoreSubmission(
            makeTmcKind({ exerciseId: 1, submissionId: 1 }),
            exercisePath,
            false,
          ),
        )

        // State saving check is based on a side effect of making a new submission.
        const newSubmissions = await unwrapResult(tmcSubmissions(tmc, 1))
        expect(newSubmissions.length).to.be.equal(submissions.length)
      })

      // Langs fails to remove folder on Windows CI
      test.skip("should be able to save the exercise state and reset it to original template", async function () {
        const submissions = await unwrapResult(tmcSubmissions(tmc, 1))
        await unwrapResult(tmc.resetExercise(idOfTmcExercise(1), exercisePath, true))

        // State saving check is based on a side effect of making a new submission.
        const newSubmissions = await unwrapResult(tmcSubmissions(tmc, 1))
        expect(newSubmissions.length).to.be.equal(submissions.length + 1)
      })

      // Langs fails to remove folder on Windows CI
      test.skip("should be able to reset exercise without saving the current state", async function () {
        const submissions = await unwrapResult(tmcSubmissions(tmc, 1))
        await unwrapResult(tmc.resetExercise(idOfTmcExercise(1), exercisePath, false))

        // State saving check is based on a side effect of making a new submission.
        const newSubmissions = await unwrapResult(tmcSubmissions(tmc, 1))
        expect(newSubmissions.length).to.be.equal(submissions.length)
      })

      test("should be able to submit the exercise for evaluation", async function () {
        let url: string | undefined
        const results = await unwrapResult(
          tmc.submitTmcExerciseAndWaitForResults(1, exercisePath, undefined, (x) => (url = x)),
        )
        expect(results.status).to.be.equal("ok")
        !url && expect.fail("expected to receive submission url during submission.")
      })

      test("should wait out the submission interval before a second submission", async function () {
        const started = Date.now()
        const firstSubmission = tmc.submitTmcExerciseAndWaitForResults(1, exercisePath)
        const second = tmc.submitTmcExerciseAndWaitForResults(1, exercisePath)
        const [, secondResult] = await Promise.all([firstSubmission, second])
        expect(secondResult.ok).to.be.true
        expect(Date.now() - started).to.be.at.least(MINIMUM_SUBMISSION_INTERVAL)
      })

      test("should be able to submit the exercise to TMC-paste", async function () {
        const pasteUrl = await unwrapResult(tmc.paste(idOfTmcExercise(1), exercisePath))
        expect(pasteUrl).to.include("localhost")
      })
    })

    suite("with a missing local exercise", function () {
      let missingExercisePath: string

      setup(async function () {
        missingExercisePath = path.join(projectsDir, "missing-course", "missing-exercise")
      })

      test("should encounter an error when attempting to clean it", async function () {
        const result = await tmc.clean(missingExercisePath)
        expect(result.val).to.be.instanceOf(RuntimeError)
      })

      test("should encounter an error when attempting to run tests for it", async function () {
        const result = await tmc.runTests(missingExercisePath).process
        expect(result.val).to.be.instanceOf(RuntimeError)
      })

      // Downloads exercise on Langs 0.18
      test.skip("should encounter an error when attempting to revert to an older submission", async function () {
        const result = await tmc.restoreSubmission(
          makeTmcKind({ exerciseId: 1, submissionId: 1 }),
          missingExercisePath,
          false,
        )
        expect(result.val).to.be.instanceOf(RuntimeError)
      })

      // Locks live in a central dir, not in the exercise, so a missing directory is re-downloaded
      // rather than failing, like the old-submission case above.
      test("should re-download the exercise when trying to reset it", async function () {
        const result = await tmc.resetExercise(idOfTmcExercise(1), missingExercisePath, false)
        expect(result.ok).to.be.true
        expect(fs.existsSync(missingExercisePath)).to.be.true
      })

      test("should encounter an error when trying to submit it", async function () {
        const result = await tmc.submitTmcExerciseAndWaitForResults(1, missingExercisePath)
        expect(result.val).to.be.instanceOf(RuntimeError)
      })

      test("should encounter an error when trying to submit it to TMC-paste", async function () {
        const result = await tmc.paste(idOfTmcExercise(404), missingExercisePath)
        expect(result.val).to.be.instanceOf(RuntimeError)
      })
    })
  })

  suite("unauthenticated user", function () {
    let onLoggedOutCalls: number
    let configDir: string
    let projectsDir: string
    let tmc: Langs

    setup(function () {
      configDir = path.join(testDir, CLIENT_CONFIG_DIR_NAME)
      clearCredentials(configDir)
      clearMoocCredentials(configDir)
      onLoggedOutCalls = 0
      projectsDir = setupProjectsDir(configDir, path.join(testDir, "tmcdata"))
      tmc = new Langs(CLI_FILE, CLIENT_NAME, "test", {
        cliConfigDir: testDir,
      })
      tmc.on("logout", () => onLoggedOutCalls++)
    })

    // The mooc half of this lives in the mooc suite below.
    test("reports not logged in without credentials", async function () {
      expect(await unwrapResult(tmc.isAuthenticated())).to.be.false
      expect(onLoggedOutCalls).to.be.equal(0)
    })

    // The device flow is the only login, so a mooc credential authenticates both backends.
    test("a stored mooc credential authenticates the tmc backend", async function () {
      writeMoocCredentials(configDir)
      expect(await unwrapResult(tmc.isAuthenticated())).to.be.true
    })

    // What a new user has; tmc-server accepts it (ACCEPT_COURSES_MOOC_FI_TOKENS), as the mock does.
    test("a stored mooc credential alone drives tmc commands", async function () {
      writeMoocCredentials(configDir)

      const courses = await unwrapResult(tmc.getCourses("test"))
      expect(courses.some((x) => x.name === "python-course")).to.be.true
      const data = await unwrapResult(tmc.getTmcCourseData(1))
      expect(data.details.name).to.be.equal("python-course")
      const downloads = await unwrapResult(tmc.downloadTmcExercises([1], true, () => {}))
      expect(downloads.downloaded.length).to.be.equal(1)
      expect(fs.existsSync(path.join(configDir, "credentials.json"))).to.be.false
    }).timeout(20000)

    test("logging out removes both the tmc and the mooc credentials", async function () {
      writeCredentials(configDir)
      writeMoocCredentials(configDir)
      await unwrapResult(tmc.deauthenticate())
      expect(fs.existsSync(path.join(configDir, "credentials.json"))).to.be.false
      expect(hasMoocCredentials(configDir)).to.be.false
      expect(await unwrapResult(tmc.isAuthenticated())).to.be.false
    })

    test("should not be able to download an exercise", async function () {
      const result = await tmc.downloadTmcExercises([1], true, () => {})
      expect(result.val).to.be.instanceOf(RuntimeError)
    })

    // None reaches the mock: the CLI refuses a tmc command without a token before any request.
    // The case pins that none quietly succeeds.
    test("should not get existing api data in general", async function () {
      // Unlike its siblings, get-course-data goes through tmc-langs' get_course_data
      // (crates/tmc-langs/src/lib.rs), whose `#[error(transparent)]` wrapping loses the client
      // error the CLI classifies as not-logged-in, so this stays the generic kind.
      const dataResult = await tmc.getTmcCourseData(0)
      expect(dataResult.val).to.be.instanceOf(RuntimeError)

      const coursesResult = await tmc.getCourses("test")
      expect(coursesResult.val).to.be.instanceOf(AuthorizationError)

      const submissionsResult = await tmcSubmissions(tmc, 1)
      expect(submissionsResult.val).to.be.instanceOf(AuthorizationError)
    })

    test("should be able to get valid organization data", async function () {
      const organizations = await unwrapResult(tmc.getTmcOrganizations())
      expect(organizations.length).to.be.equal(1, "Expected to get one organization.")
    })

    test("should not be able to give feedback", async function () {
      const feedback: SubmissionFeedback = {
        status: [{ question_id: 0, answer: "42" }],
      }
      const result = await tmc.submitSubmissionFeedback(FEEDBACK_URL, feedback)
      expect(result.val).to.be.instanceOf(AuthorizationError)
    })

    suite("with a local exercise", function () {
      this.timeout(20000)

      let exercisePath: string

      setup(async function () {
        deleteSync(projectsDir, { force: true })
        writeCredentials(configDir)
        const tmcRes = await unwrapResult(tmc.downloadTmcExercises([1], true, () => {}))
        clearCredentials(configDir)
        const downloaded = tmcRes.downloaded[0]
        if (!downloaded) {
          throw new Error("expected an exercise to have been downloaded")
        }
        exercisePath = downloaded.path
      })

      test("should be able to clean the exercise", async function () {
        const result = await unwrapResult(tmc.clean(exercisePath))
        expect(result).to.be.undefined
      })

      test("should be able to list local exercises", async function () {
        const result = (await unwrapResult(tmc.listLocalExercises())).filter(
          (x) => x.backend === "tmc" && x["course-slug"] === "python-course",
        )
        expect(result.length).to.be.equal(1)
        expect(first(result)?.["exercise-path"]).to.be.equal(exercisePath)
      })

      test("should be able to run tests for exercise", async function () {
        const result = await unwrapResult(tmc.runTests(exercisePath).process)
        expect(result.status).to.be.equal("PASSED")
      })

      test("should not be able to load old submission", async function () {
        const result = await tmc.restoreSubmission(
          makeTmcKind({ exerciseId: 1, submissionId: 1 }),
          exercisePath,
          true,
        )
        expect(result.val).to.be.instanceOf(RuntimeError)
      })

      test("should not be able to reset exercise", async function () {
        const result = await tmc.resetExercise(idOfTmcExercise(1), exercisePath, true)
        expect(result.val).to.be.instanceOf(AuthorizationError)
      })

      test("should not be able to submit exercise", async function () {
        const result = await tmc.submitTmcExerciseAndWaitForResults(1, exercisePath)
        expect(result.val).to.be.instanceOf(AuthorizationError)
      })

      test.skip("should not be able to submit exercise to TMC-paste", async function () {
        const result = await tmc.paste(idOfTmcExercise(1), exercisePath)
        expect(result.val).to.be.instanceOf(AuthorizationError)
      })
    })
  })

  // courses.mooc.fi mock (backend/mooc).
  suite("mooc backend", function () {
    this.timeout(20000)

    // fixed fixture ids (backend/mooc/fixtures.ts)
    const PYTHON_COURSE_ID = "11111111-1111-4111-8111-111111111111"
    const EXTRA_COURSE_ID = "22222222-2222-4222-8222-222222222222"
    const PASSING_EXERCISE_ID = "a1a1a1a1-0000-4000-8000-000000000001"
    const FAILING_EXERCISE_ID = "b2b2b2b2-0000-4000-8000-000000000001"
    const LIMITED_TRIES_EXERCISE_ID = "b8b8b8b8-0000-4000-8000-000000000001"
    const NONEXISTENT_EXERCISE_ID = "ffffffff-0000-4000-8000-000000000000"
    const NOT_ENROLLED_EXERCISE_ID = "eeeeeeee-0000-4000-8000-000000000000"
    const PAST_DEADLINE_EXERCISE_ID = "f6f6f6f6-0000-4000-8000-000000000001"
    const VARIANTS_COURSE_ID = "33333333-3333-4333-8333-333333333333"

    let configDir: string
    let tmc: Langs

    setup(function () {
      configDir = path.join(testDir, CLIENT_CONFIG_DIR_NAME)
      writeCredentials(configDir)
      // The mock requires a bearer, so every case runs authenticated, as a real session does.
      clearMoocCredentials(configDir)
      writeMoocCredentials(configDir)
      const projectsDir = path.join(testDir, "tmcdata")
      deleteSync(projectsDir, { force: true })
      setupProjectsDir(configDir, projectsDir)
      // Poll grading fast instead of the real ~2 s interval; the CLI inherits process.env.
      process.env.TMC_LANGS_MOOC_POLL_INTERVAL_MS = "50"
      tmc = new Langs(CLI_FILE, CLIENT_NAME, "test", { cliConfigDir: testDir })
    })

    test("should list the enrolled mooc courses", async function () {
      const courses = (await tmc.getEnrolledMoocCourses()).unwrap()
      // The fixtures' fourth course is one the student is not enrolled on.
      expect(courses.length).to.be.equal(3)
      expect(courses.some((c) => c.name === "MOOC Python Course")).to.be.true
      expect(courses.some((c) => c.name === "MOOC Unenrolled Course")).to.be.false
    })

    test("should get mooc course data with exercise slides and progress", async function () {
      const { course, slides, progress } = (await tmc.getMoocCourseData(PYTHON_COURSE_ID)).unwrap()
      expect(progress.course_id).to.be.equal(PYTHON_COURSE_ID)
      expect(course.name).to.be.equal("MOOC Python Course")
      expect(slides.length).to.be.equal(1)
      expect(slides[0]?.exercise_id).to.be.equal(PASSING_EXERCISE_ID)
      expect(slides[0]?.tasks[0]?.public_spec).to.not.be.undefined
    })

    test("should get each mooc course's AI policy, not_set where the host sends none", async function () {
      const courses = (await tmc.getEnrolledMoocCourses()).unwrap()
      const policies = Object.fromEntries(courses.map((c) => [c.id, c.ai_policy]))
      expect(policies[EXTRA_COURSE_ID]).to.equal("full_use")
      expect(policies[PYTHON_COURSE_ID]).to.equal("not_set")

      const { course } = (await tmc.getMoocCourseData(EXTRA_COURSE_ID)).unwrap()
      expect(course.ai_policy).to.equal("full_use")
    })

    // Writes a minimal python project (`requirements.txt` makes tmc-langs recognise it).
    const writeSubmittableProject = (name: string): string => {
      const dir = path.join(testDir, name)
      fs.mkdirSync(path.join(dir, "src"), { recursive: true })
      fs.writeFileSync(path.join(dir, "requirements.txt"), "")
      fs.writeFileSync(path.join(dir, "src", "main.py"), "print('hi')\n")
      return dir
    }

    test("should submit a mooc exercise and wait for a fully-graded result", async function () {
      const dir = writeSubmittableProject("mooc-submit-passing")
      const status = (await submitMoocAndWaitForGrading(tmc, PASSING_EXERCISE_ID, dir)).unwrap()
      // Submit resolves slide/task from the exercise id; the wait polls until FullyGraded.
      if (status.status !== "grading") {
        throw new Error(`expected a grading record, got ${status.status}`)
      }
      expect(status.grading.grading_progress).to.equal("FullyGraded")
      expect(status.grading.score_given).to.equal(1)
    })

    test("should submit its archive with the tmc answer-archive content type", async function () {
      // Only an end-to-end run can observe the multipart part's Content-Type: reqwest infers it
      // from the extensionless temp archive, and the host stores it unchecked, so a wrong one
      // surfaces only in the entry extensions of a teacher's exported answer-file zip.
      const dir = writeSubmittableProject("mooc-submit-mime")
      ;(await submitMoocAndWaitForGrading(tmc, PASSING_EXERCISE_ID, dir)).unwrap()

      // Read from the host's record: nothing in the extension consumes `mime`.
      const submissions = (await moocSubmissions(tmc, PASSING_EXERCISE_ID)).unwrap()
      const newest = first(submissions)
      expect(newest, "the submit must be listed").to.not.be.undefined
      const download = await fetch(
        `${MOCK_BACKEND_URL}/api/v0/exercise-services/client/submissions/${newest!.id}/download`,
        { headers: { authorization: `Bearer ${MOCK_SEEDED_ACCESS_TOKEN}` } },
      )
      expect(download.status).to.equal(200)
      const body = (await download.json()) as { data_files: { name: string; mime: string }[] }
      expect(body.data_files).to.have.lengthOf(1)
      expect(body.data_files[0]?.mime).to.equal(TMC_ARCHIVE_MIME)
    })

    test("should grade a failing mooc exercise fully, to zero points and not passed", async function () {
      const dir = writeSubmittableProject("mooc-submit-failing")
      const status = (await submitMoocAndWaitForGrading(tmc, FAILING_EXERCISE_ID, dir)).unwrap()
      if (status.status !== "grading") {
        throw new Error(`expected a grading record, got ${status.status}`)
      }
      expect(status.grading.grading_progress).to.equal("FullyGraded")
      expect(status.grading.score_given).to.equal(0)
      expect(status.grading.exercise_progress?.standing).to.equal("Attempted")
      // The tmc service's RunResult, read out of feedback_json by the CLI.
      expect(status.grading.test_results?.status).to.equal("TESTS_FAILED")
      expect(
        status.grading.test_results?.test_results.map((result) => [result.name, result.successful]),
      ).to.deep.equal([
        ["HelloTest.greets", true],
        ["HelloTest.counts", false],
      ])
      expect(status.grading.test_results?.logs).to.deep.equal({})
    })

    test("should transparently re-upload when the first upload is reaped before submit", async function () {
      // Upload-then-submit races; the CLI recovers by re-uploading once. Timing cannot provoke it,
      // so the mock is asked to reap the next upload. Without the retry: `upload-expired`.
      const armed = await fetch(`${MOCK_BACKEND_URL}/mooc-mock/expire-next-upload`, {
        method: "POST",
      })
      expect(armed.status).to.be.equal(204)

      const dir = writeSubmittableProject("mooc-submit-reaped")
      const status = (await submitMoocAndWaitForGrading(tmc, PASSING_EXERCISE_ID, dir)).unwrap()
      if (status.status !== "grading") {
        throw new Error(`expected a grading record, got ${status.status}`)
      }
      expect(status.grading.grading_progress).to.equal("FullyGraded")
    })

    test("should report submitting a nonexistent mooc exercise as the exercise being gone", async function () {
      const dir = writeSubmittableProject("mooc-submit-nonexistent")
      const result = await tmc.submitMoocExercise(NONEXISTENT_EXERCISE_ID, dir)
      expect(result.val).to.be.instanceOf(ExerciseNotFoundError)
    })

    // The refusal the course home reports, and the list that clears it.
    test("should report submitting to a course the student is not enrolled on as not enrolled", async function () {
      const dir = writeSubmittableProject("mooc-submit-not-enrolled")
      const result = await tmc.submitMoocExercise(NOT_ENROLLED_EXERCISE_ID, dir)
      expect(result.val).to.be.instanceOf(NotEnrolledError)
    })

    test("should report a submit past the deadline as the deadline having passed", async function () {
      const dir = writeSubmittableProject("mooc-submit-past-deadline")
      const result = await tmc.submitMoocExercise(PAST_DEADLINE_EXERCISE_ID, dir)
      expect(result.val).to.be.instanceOf(DeadlinePassedError)
    })

    test("should report a submit to a locked chapter as the lock, not as a lost login", async function () {
      const dir = writeSubmittableProject("mooc-submit-locked")
      const result = await inChapter(
        FAILING_EXERCISE_ID,
        { locking_status: "not_unlocked_yet" },
        () => tmc.submitMoocExercise(FAILING_EXERCISE_ID, dir),
      )
      expect(result.val).to.be.instanceOf(ChapterLockedError)
    })

    test("should hide a closed chapter's exercises from course data, listing them as closed", async function () {
      const { slides, progress } = await inChapter(
        PASSING_EXERCISE_ID,
        { opens_at: "2100-01-01T00:00:00Z" },
        async () =>
          (await tmc.getMoocCourseData(PYTHON_COURSE_ID, { forceRefresh: true })).unwrap(),
      )
      expect(slides).to.deep.equal([])
      expect(
        progress.closed_chapters.map((c) => c.exercises.map((e) => e.exercise_id)),
      ).to.deep.equal([[PASSING_EXERCISE_ID]])
    })

    test("should serve an exercise its chapter's deadline and locking status", async function () {
      const { slides } = await inChapter(
        PASSING_EXERCISE_ID,
        { deadline: "2099-01-01T00:00:00Z", locking_status: "completed_and_locked" },
        async () =>
          (await tmc.getMoocCourseData(PYTHON_COURSE_ID, { forceRefresh: true })).unwrap(),
      )
      expect(Date.parse(slides[0]?.deadline ?? "")).to.equal(Date.parse("2099-01-01T00:00:00Z"))
      expect(slides[0]?.chapter?.locking_status).to.equal("CompletedAndLocked")
    })

    test("should leave a course the student was withdrawn from out of the enrolled courses", async function () {
      const setEnrolled = (enrolled: boolean): Promise<Response> =>
        fetch(`${MOCK_BACKEND_URL}/mooc-mock/set-enrolled`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ course_id: PYTHON_COURSE_ID, enrolled }),
        })
      expect((await setEnrolled(false)).status).to.equal(204)
      try {
        const courses = (await tmc.getEnrolledMoocCourses()).unwrap()
        expect(courses.some((c) => c.id === PYTHON_COURSE_ID)).to.be.false
      } finally {
        await setEnrolled(true)
      }
    })

    suite("a course students can no longer reach", function () {
      const setCourseAccess = (access: string): Promise<Response> =>
        fetch(`${MOCK_BACKEND_URL}/mooc-mock/set-course-access`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ course_id: PYTHON_COURSE_ID, access }),
        })

      teardown(async function () {
        expect((await setCourseAccess("open")).status).to.equal(204)
      })

      // The extension tells this from a missing scope by the course list, which still loads.
      test("should report a closed course as an insufficient scope", async function () {
        expect((await setCourseAccess("forbidden")).status).to.equal(204)

        const data = await tmc.getMoocCourseData(PYTHON_COURSE_ID, { forceRefresh: true })

        expect(data.val).to.be.instanceOf(InsufficientScopeError)
        expect((await tmc.getEnrolledMoocCourses()).ok).to.be.true
      })

      test("should report a deleted course as not found", async function () {
        expect((await setCourseAccess("deleted")).status).to.equal(204)

        const data = await tmc.getMoocCourseData(PYTHON_COURSE_ID, { forceRefresh: true })

        expect(data.val).to.be.instanceOf(NotFoundError)
        expect((data.val as NotFoundError).httpStatus).to.equal(404)
      })

      const leavesUncheckedAlone = (
        access: string,
        refusal: typeof InsufficientScopeError | typeof NotFoundError,
      ) =>
        async function (): Promise<void> {
          const ids = [PASSING_EXERCISE_ID, FAILING_EXERCISE_ID]
          ;(await tmc.downloadMoocExercises(ids, undefined, () => {})).unwrap()
          expect((await setCourseAccess(access)).status).to.equal(204)

          const updates = (await tmc.checkExerciseUpdates("mooc", { forceRefresh: true })).unwrap()

          expect(updates.removed).to.deep.equal([])
          expect(updates.uncheckedCourses).to.have.length(1)
          const [unchecked] = updates.uncheckedCourses ?? []
          expect(unchecked?.courseId).to.deep.equal(idOfMoocCourse(PYTHON_COURSE_ID))
          expect(unchecked?.refusal).to.be.instanceOf(refusal)
        }

      test(
        "should leave a closed course unchecked and still check the others",
        leavesUncheckedAlone("forbidden", InsufficientScopeError),
      )

      test(
        "should leave a deleted course unchecked and still check the others",
        leavesUncheckedAlone("deleted", NotFoundError),
      )
    })

    test("should paste a mooc exercise as a shared, ungraded snapshot", async function () {
      const dir = writeSubmittableProject("mooc-paste")
      const pasteUrl = (await tmc.paste(idOfMoocExercise(PASSING_EXERCISE_ID), dir)).unwrap()
      expect(pasteUrl).to.match(/\/shared-submissions\/[0-9a-f-]+$/)

      const newest = first((await moocSubmissions(tmc, PASSING_EXERCISE_ID)).unwrap())
      expect(newest?.kind).to.equal("paste")
      expect(newest?.is_shared).to.equal(true)
      expect(newest?.grading_progress).to.equal(null)
    })

    test("should paste an exercise with no tries left, using none, and refuse a submit", async function () {
      const dir = writeSubmittableProject("mooc-paste-out-of-tries")
      const graded = (
        await submitMoocAndWaitForGrading(tmc, LIMITED_TRIES_EXERCISE_ID, dir)
      ).unwrap()
      if (graded.status !== "grading") {
        throw new Error(`expected a grading record, got ${graded.status}`)
      }
      expect(graded.grading.exercise_progress?.standing).to.equal("OutOfTries")

      ;(await tmc.paste(idOfMoocExercise(LIMITED_TRIES_EXERCISE_ID), dir)).unwrap()

      const listed = (await moocSubmissions(tmc, LIMITED_TRIES_EXERCISE_ID)).unwrap()
      expect(listed.map((item) => item.kind)).to.deep.equal(["paste", "submission"])

      const refused = await tmc.submitMoocExercise(LIMITED_TRIES_EXERCISE_ID, dir)
      expect(refused.val).to.be.instanceOf(OutOfTriesError)
      const { progress } = (
        await tmc.getMoocCourseData(VARIANTS_COURSE_ID, { forceRefresh: true })
      ).unwrap()
      const limited = progress.exercises.find((e) => e.exercise_id === LIMITED_TRIES_EXERCISE_ID)
      expect([limited?.max_tries, limited?.tries_left]).to.deep.equal([1, 0])
    })

    test("should report a review holding the points back, and refuse a locked exercise", async function () {
      const dir = writeSubmittableProject("mooc-under-review")
      const setReview = (review: string | null): Promise<Response> =>
        fetch(`${MOCK_BACKEND_URL}/mooc-mock/set-exercise-review`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ exercise_id: PASSING_EXERCISE_ID, review }),
        })
      expect((await setReview("awaits_teacher")).status).to.equal(204)
      try {
        const { progress } = (
          await tmc.getMoocCourseData(PYTHON_COURSE_ID, { forceRefresh: true })
        ).unwrap()
        const held = progress.exercises.find((e) => e.exercise_id === PASSING_EXERCISE_ID)
        expect([held?.pending_teacher_review, held?.exercise_locked]).to.deep.equal([
          "awaits_teacher",
          true,
        ])
        const refused = await tmc.submitMoocExercise(PASSING_EXERCISE_ID, dir)
        expect(refused.val).to.be.instanceOf(ExerciseLockedError)
      } finally {
        await setReview(null)
      }
    })

    test("should refuse pasting one exercise too often as rate limited", async function () {
      const dir = writeSubmittableProject("mooc-paste-rate-limited")
      const exerciseId = idOfMoocExercise(FAILING_EXERCISE_ID)
      for (let i = 0; i < 3; i++) {
        ;(await tmc.paste(exerciseId, dir)).unwrap()
      }
      const refused = await tmc.paste(exerciseId, dir)
      expect(refused.val).to.be.instanceOf(RateLimitedError)
    })

    test("should back up, not submit, the current state before a reset", async function () {
      await tmc.downloadMoocExercises([PASSING_EXERCISE_ID], PYTHON_COURSE_ID, () => {})
      const entry = (await tmc.listLocalExercises())
        .unwrap()
        .find((x) => x.backend === "mooc" && x["exercise-id"] === PASSING_EXERCISE_ID)
      const exercisePath = (entry as { "exercise-path": string })["exercise-path"]
      const before = (await moocSubmissions(tmc, PASSING_EXERCISE_ID)).unwrap()

      ;(await tmc.resetExercise(idOfMoocExercise(PASSING_EXERCISE_ID), exercisePath, true)).unwrap()

      const after = (await moocSubmissions(tmc, PASSING_EXERCISE_ID)).unwrap()
      expect(after.length).to.equal(before.length + 1)
      expect(after[0]?.kind).to.equal("backup")
      expect(after[0]?.score_given).to.equal(null)
    })

    test("should report a downloaded exercise its course no longer has as removed", async function () {
      await tmc.downloadMoocExercises([PASSING_EXERCISE_ID], PYTHON_COURSE_ID, () => {})
      const setRemoved = (removed: boolean): Promise<Response> =>
        fetch(`${MOCK_BACKEND_URL}/mooc-mock/set-exercise-removed`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ exercise_id: PASSING_EXERCISE_ID, removed }),
        })
      expect((await setRemoved(true)).status).to.equal(204)
      try {
        const updates = (await tmc.checkExerciseUpdates("mooc", { forceRefresh: true })).unwrap()
        expect(updates).to.deep.equal({
          updated: [],
          removed: [idOfMoocExercise(PASSING_EXERCISE_ID)],
          uncheckedCourses: [],
        })
      } finally {
        await setRemoved(false)
      }
    })

    test("should download mooc exercises then skip them by checksum", async function () {
      const ids = [PASSING_EXERCISE_ID, FAILING_EXERCISE_ID]
      const firstMooc = (await tmc.downloadMoocExercises(ids, undefined, () => {})).unwrap()
      expect(firstMooc.downloaded.length).to.be.equal(2)
      expect(firstMooc.skipped.length).to.be.equal(0)

      // Identical checksums: skipped, not re-downloaded.
      const secondMooc = (await tmc.downloadMoocExercises(ids, undefined, () => {})).unwrap()
      expect(secondMooc.downloaded.length).to.be.equal(0)
      expect(secondMooc.skipped.length).to.be.equal(2)
    })

    test("should report a failed entry for a nonexistent mooc exercise", async function () {
      const mooc = (
        await tmc.downloadMoocExercises([NONEXISTENT_EXERCISE_ID], undefined, () => {})
      ).unwrap()
      expect(mooc.failed.length).to.be.equal(1)
    })

    test("should key mooc download results by the requested exercise id", async function () {
      const mooc = (
        await tmc.downloadMoocExercises([PASSING_EXERCISE_ID], undefined, () => {})
      ).unwrap()
      expect(mooc.downloaded.length).to.be.equal(1)
      expect(mooc.downloaded[0]?.id).to.deep.equal(idOfMoocExercise(PASSING_EXERCISE_ID))
    })

    test("should download with --course-id and then list the local mooc exercise with its slug", async function () {
      // The course id drives single-course resolution; the exercise must then be listed locally
      // under it with a slug and path for the workspace manager.
      const downloaded = (
        await tmc.downloadMoocExercises([PASSING_EXERCISE_ID], PYTHON_COURSE_ID, () => {})
      ).unwrap()
      expect(downloaded.downloaded.length).to.be.equal(1)

      const local = (await tmc.listLocalExercises()).unwrap()
      const entry = local.find(
        (x) =>
          x.backend === "mooc" &&
          x["course-id"] === PYTHON_COURSE_ID &&
          x["exercise-id"] === PASSING_EXERCISE_ID,
      )
      expect(entry, "the downloaded exercise should be listed locally").to.not.be.undefined
      expect(entry?.["exercise-slug"]).to.be.a("string").and.not.be.empty
      expect(entry?.["exercise-path"]).to.be.a("string").and.not.be.empty
    })

    test("should submit twice, list both newest-first, and restore an old submission", async function () {
      await tmc.downloadMoocExercises([PASSING_EXERCISE_ID], PYTHON_COURSE_ID, () => {})
      const local = (await tmc.listLocalExercises()).unwrap()
      const entry = local.find(
        (x) =>
          x.backend === "mooc" &&
          x["course-id"] === PYTHON_COURSE_ID &&
          x["exercise-id"] === PASSING_EXERCISE_ID,
      )
      const exercisePath = (entry as { "exercise-path": string })["exercise-path"]
      const studentFile = path.join(exercisePath, "src", "passing_exercise.py")
      expect(fs.existsSync(studentFile)).to.be.true

      // The mock keeps submissions for the whole suite, so measure relative to what is there.
      const before = (await moocSubmissions(tmc, PASSING_EXERCISE_ID)).unwrap()

      // Distinct content per submission, so a restore provably serves that submission's own
      // content, not the stub (what is on disk after download) or the newer one.
      const stubContent = fs.readFileSync(studentFile, "utf8")
      const olderContent = `${stubContent}\n# older submission marker (restore target)\n`
      const newerContent = `${stubContent}\n# newer submission marker (must not be restored)\n`
      expect(olderContent).to.not.equal(newerContent)
      expect(olderContent).to.not.equal(stubContent)

      // Each submission captures the file content at submit time. A fresh Langs skips the wait
      // between consecutive submits of one instance.
      fs.writeFileSync(studentFile, olderContent)
      ;(await submitMoocAndWaitForGrading(tmc, PASSING_EXERCISE_ID, exercisePath)).unwrap()
      fs.writeFileSync(studentFile, newerContent)
      const secondSubmitter = new Langs(CLI_FILE, CLIENT_NAME, "test", { cliConfigDir: testDir })
      ;(
        await submitMoocAndWaitForGrading(secondSubmitter, PASSING_EXERCISE_ID, exercisePath)
      ).unwrap()

      const after = (await moocSubmissions(tmc, PASSING_EXERCISE_ID)).unwrap()
      expect(after.length).to.be.equal(before.length + 2)
      // Newest first: the two just submitted lead, with distinct ids and non-increasing created_at.
      expect(after[0]?.id).to.not.equal(after[1]?.id)
      for (let i = 1; i < after.length; i++) {
        expect(new Date(after[i - 1]!.created_at).getTime()).to.be.at.least(
          new Date(after[i]!.created_at).getTime(),
        )
      }

      // Restoring the older submission must bring back the older content, over the newer content
      // on disk after the second submit.
      const olderId = after[1]!.id
      fs.writeFileSync(studentFile, newerContent)
      const restore = (
        await tmc.restoreSubmission(
          makeMoocKind({ exerciseId: PASSING_EXERCISE_ID, submissionId: olderId }),
          exercisePath,
          false,
        )
      ).unwrap()
      expect(restore).to.equal("restored")
      expect(fs.existsSync(studentFile)).to.be.true
      const restored = fs.readFileSync(studentFile, "utf8")
      expect(restored).to.equal(olderContent)
      expect(restored).to.not.equal(newerContent)
      expect(restored).to.not.equal(stubContent)
    })

    test("should report nothing-to-download for a submission with no files, leaving the exercise alone", async function () {
      // Only an exercise type with no files downloads as an empty list; the CLI always uploads
      // first, so only seeding the mock reaches this.
      await tmc.downloadMoocExercises([PASSING_EXERCISE_ID], PYTHON_COURSE_ID, () => {})
      const local = (await tmc.listLocalExercises()).unwrap()
      const entry = local.find(
        (x) =>
          x.backend === "mooc" &&
          x["course-id"] === PYTHON_COURSE_ID &&
          x["exercise-id"] === PASSING_EXERCISE_ID,
      )
      const exercisePath = (entry as { "exercise-path": string })["exercise-path"]
      const studentFile = path.join(exercisePath, "src", "passing_exercise.py")

      const seedResponse = await fetch(`${MOCK_BACKEND_URL}/mooc-mock/seed-fileless-submission`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ exercise_id: PASSING_EXERCISE_ID }),
      })
      expect(seedResponse.status).to.be.equal(200)
      const { slide_submission_id: filelessId } = (await seedResponse.json()) as {
        slide_submission_id: string
      }

      const onDisk = `${fs.readFileSync(studentFile, "utf8")}\n# must survive the restore\n`
      fs.writeFileSync(studentFile, onDisk)
      const before = (await moocSubmissions(tmc, PASSING_EXERCISE_ID)).unwrap()

      // `--save-old-state` on deliberately: the archive url is resolved first, so the zero-file
      // case must return before submitting the current state and rebuilding the directory.
      const restore = (
        await tmc.restoreSubmission(
          makeMoocKind({ exerciseId: PASSING_EXERCISE_ID, submissionId: filelessId }),
          exercisePath,
          true,
        )
      ).unwrap()
      expect(restore).to.equal("nothing-to-download")
      expect(fs.readFileSync(studentFile, "utf8")).to.equal(onDisk)
      const after = (await moocSubmissions(tmc, PASSING_EXERCISE_ID)).unwrap()
      expect(after.length).to.be.equal(before.length)
    })

    test("reports the login status the stored mooc credentials give", async function () {
      clearCredentials(configDir)
      clearMoocCredentials(configDir)
      expect((await tmc.isAuthenticated()).unwrap()).to.be.false
      writeMoocCredentials(configDir)
      expect((await tmc.isAuthenticated()).unwrap()).to.be.true
    })

    test("names the account the stored mooc credentials act for, and another once switched", async function () {
      writeMoocCredentials(configDir)
      expect((await tmc.getMoocAccountId()).unwrap()).to.equal(MOCK_DEFAULT_USER_ID)
      const otherUserId = "0d6a3a7e-1f0b-4c8e-8f3d-6b2a9c4e5f70"
      expect((await setCurrentUser(otherUserId)).status).to.equal(204)
      try {
        expect((await tmc.getMoocAccountId()).unwrap()).to.equal(otherUserId)
      } finally {
        await setCurrentUser(MOCK_DEFAULT_USER_ID)
      }
    })

    test("deauthenticate removes the stored mooc credentials", async function () {
      writeMoocCredentials(configDir)
      ;(await tmc.deauthenticate()).unwrap()
      expect(hasMoocCredentials(configDir)).to.be.false
    })

    suite("device flow", function () {
      let savedClientId: string | undefined

      setup(async function () {
        clearMoocCredentials(configDir)
        // Restarts the mock's user-code numbering.
        const reset = await fetch(`${MOCK_BACKEND_URL}/mooc-mock/reset`, { method: "POST" })
        expect(reset.status).to.equal(204)
        // Poll fast; the mock approves the pending grant only after ~5s (backend/mooc/oauth.ts).
        process.env.TMC_LANGS_MOOC_DEVICE_POLL_INTERVAL_MS = "50"
        savedClientId = process.env.TMC_LANGS_MOOC_CLIENT_ID
      })

      teardown(function () {
        if (savedClientId === undefined) {
          delete process.env.TMC_LANGS_MOOC_CLIENT_ID
        } else {
          process.env.TMC_LANGS_MOOC_CLIENT_ID = savedClientId
        }
      })

      test("authenticate runs the device flow and stores credentials", async function () {
        let deviceInfo: { user_code: string; verification_uri: string } | undefined
        const { result } = tmc.authenticate((info) => {
          deviceInfo = info
        })
        const res = await result
        expect(res.ok, res.err ? `login failed: ${res.val.message}` : "").to.be.true
        // The CLI emits the device code before blocking on the poll loop.
        expect(deviceInfo?.user_code).to.equal(mockUserCode(1))
        expect(deviceInfo?.verification_uri).to.contain("/oauth_device")
        expect(hasMoocCredentials(configDir)).to.be.true
      })

      test("a device code that expires before approval fails the login", async function () {
        process.env.TMC_LANGS_MOOC_CLIENT_ID = "mooc-mock-expired"
        const res = await tmc.authenticate(() => {}).result
        expect(res.val).to.be.instanceOf(DeviceLoginExpiredError)
        expect(hasMoocCredentials(configDir)).to.be.false
      })

      // The mock answers slow_down until a full interval has passed, and approves only after two.
      test("a login told to slow down still completes", async function () {
        this.timeout(40000)
        process.env.TMC_LANGS_MOOC_CLIENT_ID = "mooc-mock-slowdown"
        const res = await tmc.authenticate(() => {}).result
        expect(res.ok, res.err ? `login failed: ${res.val.message}` : "").to.be.true
        expect(hasMoocCredentials(configDir)).to.be.true
      })
    })
  })

  // A second mock instance, so cases holding a rejected or expiring credential cannot disturb the
  // suite above, which shares one token. Pins the 401/403 -> refresh-retry/delete path.
  suite("mooc backend (bearer auth)", function () {
    this.timeout(30000)

    const AUTH_PORT = 4002
    const AUTH_BASE = `http://localhost:${AUTH_PORT}`

    let authServer: cp.ChildProcess | undefined
    let configDir: string
    let savedRootUrl: string | undefined
    let savedTrust: string | undefined
    let tmc: Langs

    suiteSetup(async function () {
      this.timeout(30000)
      authServer = await startServer({ PORT: String(AUTH_PORT) })
    })

    setup(async function () {
      // Env vars are saved and restored so the other suites (on the 4001 instance) are unaffected.
      savedRootUrl = process.env.TMC_LANGS_MOOC_ROOT_URL
      savedTrust = process.env.TMC_LANGS_MOOC_TRUST_LOCALHOST
      process.env.TMC_LANGS_MOOC_ROOT_URL = AUTH_BASE
      process.env.TMC_LANGS_MOOC_TRUST_LOCALHOST = "1"
      // Cases expire server-side tokens; restoring the seeded ones keeps the suite order-independent.
      const reset = await fetch(`${AUTH_BASE}/mooc-mock/reset`, { method: "POST" })
      expect(reset.status).to.equal(204)
      configDir = path.join(testDir, CLIENT_CONFIG_DIR_NAME)
      clearMoocCredentials(configDir)
      const projectsDir = path.join(testDir, "tmcdata")
      deleteSync(projectsDir, { force: true })
      setupProjectsDir(configDir, projectsDir)
      tmc = new Langs(CLI_FILE, CLIENT_NAME, "test", { cliConfigDir: testDir })
    })

    teardown(function () {
      if (savedRootUrl === undefined) {
        delete process.env.TMC_LANGS_MOOC_ROOT_URL
      } else {
        process.env.TMC_LANGS_MOOC_ROOT_URL = savedRootUrl
      }
      if (savedTrust === undefined) {
        delete process.env.TMC_LANGS_MOOC_TRUST_LOCALHOST
      } else {
        process.env.TMC_LANGS_MOOC_TRUST_LOCALHOST = savedTrust
      }
    })

    suiteTeardown(async function () {
      await stopServer(authServer)
    })

    test("attaches the bearer to a resource call and succeeds; the mock records it", async function () {
      writeMoocCredentials(configDir)
      const courses = (await tmc.getEnrolledMoocCourses()).unwrap()
      expect(courses.length).to.be.greaterThan(0)
      // Proves the CLI attached the bearer; without TMC_LANGS_MOOC_TRUST_LOCALHOST this would 401.
      const state = (await (await fetch(`${AUTH_BASE}/mooc-mock/auth-state`)).json()) as {
        lastAuthorization: string
        authenticatedRequestCount: number
      }
      expect(state.lastAuthorization).to.equal(`Bearer ${MOCK_SEEDED_ACCESS_TOKEN}`)
      expect(state.authenticatedRequestCount).to.be.greaterThan(0)
    })

    test("refreshes an expired stored token, then retries without a visible auth error", async function () {
      writeMoocCredentials(configDir, {
        // Unrecognised token; the expired lifetime forces a proactive refresh.
        accessToken: "mock-access-expired",
        // The seeded token the mock always honours; it rejects any token it did not issue.
        refreshToken: MOCK_SEEDED_REFRESH_TOKEN,
        expiresIn: 3600,
        obtainedAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
      })
      const courses = (await tmc.getEnrolledMoocCourses()).unwrap()
      expect(courses.length).to.be.greaterThan(0)
      // The refreshed credentials are kept.
      expect(hasMoocCredentials(configDir)).to.be.true
    })

    test("deletes credentials and reports logged-out when the refresh is rejected", async function () {
      writeMoocCredentials(configDir, {
        accessToken: "mock-access-expired",
        // The mock rejects this with a permanent `invalid_grant`.
        refreshToken: MOCK_INVALID_REFRESH_TOKEN,
        expiresIn: 3600,
        obtainedAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
      })
      expect(hasMoocCredentials(configDir)).to.be.true
      const res = await tmc.getEnrolledMoocCourses()
      expect(res.err).to.be.true
      expect(hasMoocCredentials(configDir)).to.be.false
    })

    // Revokes the token server-side while the stored credentials still look valid: the only way to
    // reach the reactive path, as the proactive cases above refresh before any 401.
    const expireAccessToken = async (accessToken: string): Promise<void> => {
      const res = await fetch(`${AUTH_BASE}/mooc-mock/expire-access-token`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ access_token: accessToken }),
      })
      expect(res.status).to.equal(204)
    }

    test("refreshes and retries when a token it believed valid is rejected", async function () {
      writeMoocCredentials(configDir, {
        accessToken: MOCK_SEEDED_ACCESS_TOKEN,
        refreshToken: MOCK_SEEDED_REFRESH_TOKEN,
        expiresIn: 3600,
      })
      await expireAccessToken(MOCK_SEEDED_ACCESS_TOKEN)
      const courses = (await tmc.getEnrolledMoocCourses()).unwrap()
      expect(courses.length).to.be.greaterThan(0)
      expect(hasMoocCredentials(configDir)).to.be.true
    })

    test("reports a revoked grant as an invalid token, deleting the credentials", async function () {
      writeMoocCredentials(configDir, {
        accessToken: MOCK_SEEDED_ACCESS_TOKEN,
        refreshToken: MOCK_SEEDED_REFRESH_TOKEN,
        expiresIn: 3600,
      })
      const revoked = await fetch(`${AUTH_BASE}/mooc-mock/revoke-grant`, { method: "POST" })
      expect(revoked.status).to.equal(204)

      const courses = await tmc.getEnrolledMoocCourses()

      expect(courses.val).to.be.instanceOf(InvalidTokenError)
      expect(hasMoocCredentials(configDir)).to.be.false
    })

    test("deletes credentials when the refresh after a rejection also fails", async function () {
      writeMoocCredentials(configDir, {
        accessToken: MOCK_SEEDED_ACCESS_TOKEN,
        refreshToken: MOCK_INVALID_REFRESH_TOKEN,
        expiresIn: 3600,
      })
      await expireAccessToken(MOCK_SEEDED_ACCESS_TOKEN)
      const res = await tmc.getEnrolledMoocCourses()
      expect(res.err).to.be.true
      expect(hasMoocCredentials(configDir)).to.be.false
    })
  })

  suiteTeardown(async function () {
    await stopServer(server)
    if (anyTestFailed) {
      console.info(`Keeping the artifacts of this run at ${runArtifactDir}`)
    } else {
      fs.rmSync(runArtifactDir, { recursive: true, force: true })
    }
  })
})

// Defaults to the token the tmc mock accepts; pass another to have the backend reject it.
function writeCredentials(configDir: string, accessToken?: string): void {
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true })
  }
  fs.writeFileSync(
    path.join(configDir, "credentials.json"),
    JSON.stringify(tmcCredentials(accessToken)),
  )
}

function clearCredentials(configDir: string): void {
  deleteSync(path.join(configDir, "credentials.json"), { force: true })
}

// Seeds the mooc credentials as a successful `mooc login` would. Mirrors the stored
// `{token, obtained_at}` wrapper (token is a serialized oauth2 StandardTokenResponse); separate
// from the legacy `credentials.json` that `writeCredentials` seeds.
function writeMoocCredentials(
  configDir: string,
  options?: {
    accessToken?: string
    refreshToken?: string
    expiresIn?: number
    // Defaults to now; a past value plus `expiresIn` expires the token, forcing a refresh.
    obtainedAt?: string
  },
): void {
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true })
  }
  const token: Record<string, unknown> = {
    access_token: options?.accessToken ?? MOCK_SEEDED_ACCESS_TOKEN,
    token_type: "bearer",
    scope: "exercise-services",
  }
  if (options?.expiresIn !== undefined) {
    token.expires_in = options.expiresIn
  }
  if (options?.refreshToken !== undefined) {
    token.refresh_token = options.refreshToken
  }
  fs.writeFileSync(
    path.join(configDir, moocCredentialsFileName()),
    JSON.stringify({ token, obtained_at: options?.obtainedAt ?? new Date().toISOString() }),
  )
}

// This machine's `credentials_mooc_<host>.json`. Mirrors `host_key` in tmc-langs-rust's
// crates/tmc-langs/src/config/mooc_credentials.rs; a mismatch makes the seeded credential ignored.
function moocCredentialsFileName(): string {
  const raw = process.platform === "win32" ? (process.env.COMPUTERNAME ?? "") : os.hostname()
  const host = [...raw.trim().toLowerCase()]
    .slice(0, 64)
    .map((c) => (/[a-z0-9._-]/.test(c) ? c : "_"))
    .join("")
  return /[a-z0-9]/.test(host) ? `credentials_mooc_${host}.json` : "credentials_mooc.json"
}

async function tmcSubmissions(
  langs: Langs,
  exerciseId: number,
): Promise<Result<Submission[], Error>> {
  const listed = await langs.getOldSubmissions(makeTmcKind({ tmcExerciseId: exerciseId }))
  return listed.map((old) => (old.kind === "tmc" ? old.data.submissions : []))
}

async function moocSubmissions(
  langs: Langs,
  exerciseId: string,
): Promise<Result<ExerciseSlideSubmissionListItem[], Error>> {
  const listed = await langs.getOldSubmissions(makeMoocKind({ moocExerciseId: exerciseId }))
  return listed.map((old) => (old.kind === "mooc" ? old.data.submissions : []))
}

function hasMoocCredentials(configDir: string): boolean {
  return fs.existsSync(path.join(configDir, moocCredentialsFileName()))
}

// Also removes a shared `credentials_mooc.json` an older CLI left behind, which langs would adopt.
function clearMoocCredentials(configDir: string): void {
  if (!fs.existsSync(configDir)) {
    return
  }
  for (const entry of fs.readdirSync(configDir)) {
    if (/^credentials_mooc(_.*)?\.json$/.test(entry)) {
      deleteSync(path.join(configDir, entry), { force: true })
    }
  }
}

function setupProjectsDir(configDir: string, projectsDir: string): string {
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true })
  }
  fs.writeFileSync(path.join(configDir, "config.toml"), `projects-dir = '${projectsDir}'\n`)
  return projectsDir
}

/** Submits like the extension does: without blocking, then waiting for the grading. */
async function submitMoocAndWaitForGrading(
  langs: Langs,
  exerciseId: string,
  exercisePath: string,
): Promise<Result<ExerciseTaskSubmissionStatus, Error>> {
  const submitted = await langs.submitMoocExercise(exerciseId, exercisePath)
  return submitted.err ? submitted : langs.waitForMoocGrading(submitted.val.task_submission_id)
}

async function unwrapResult<T>(result: Promise<Result<T, Error>>): Promise<T> {
  const res = await result
  if (res.err) {
    expect.fail(`TMC-langs execution failed: ${res.val.message}`)
  }
  return res.val
}

const SERVER_READY_MARKER = "Server listening to"
const SERVER_START_TIMEOUT_MS = 20_000

/**
 * Starts the bundled mock backend (backend/index.ts), resolving once it is listening. Rejects,
 * having killed it, if it exits first or stays silent past {@link SERVER_START_TIMEOUT_MS}.
 *
 * `extraEnv` is layered over the current environment; a second instance needs at least a `PORT`.
 */
async function startServer(extraEnv: Record<string, string> = {}): Promise<cp.ChildProcess> {
  const backendPath = path.join(__dirname, "..", "backend")
  console.log("Running pnpm start at", backendPath, "with env", extraEnv)
  const server = cp.spawn("pnpm", ["start"], {
    cwd: backendPath,
    shell: "bash",
    env: { ...process.env, ...extraEnv },
    // The listener is a grandchild (shell -> pnpm -> node); on POSIX its own process group lets
    // one signal kill the chain (see stopServer).
    detached: process.platform !== "win32",
  })
  console.info("[server] starting...")

  let stdout = ""
  const listening = new Promise<void>((resolve) => {
    server.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString()
      console.info(`[server] ${text}`)
      // Matched against all output so far: the marker can straddle chunks.
      stdout += text
      if (stdout.includes(SERVER_READY_MARKER)) {
        resolve()
      }
    })
  })
  // An unread stderr pipe eventually fills and blocks the child; it also says why a start failed.
  server.stderr.on("data", (chunk: Buffer) => console.error(`[server] ${chunk.toString()}`))

  let onExit: ((code: number | null, signal: NodeJS.Signals | null) => void) | undefined
  const exited = new Promise<never>((_resolve, reject) => {
    onExit = (code, signal) =>
      reject(
        new Error(
          `The mock backend exited before it was listening (code ${code}, signal ${signal})`,
        ),
      )
    server.once("exit", onExit)
  })
  let deadline: NodeJS.Timeout | undefined
  const timedOut = new Promise<never>((_resolve, reject) => {
    deadline = setTimeout(
      () =>
        reject(
          new Error(
            `The mock backend did not report "${SERVER_READY_MARKER}" within ${SERVER_START_TIMEOUT_MS}ms`,
          ),
        ),
      SERVER_START_TIMEOUT_MS,
    )
  })

  try {
    await Promise.race([listening, exited, timedOut])
  } catch (error) {
    await stopServer(server)
    throw error
  } finally {
    clearTimeout(deadline)
    // Else the teardown kill rejects a promise nobody awaits.
    if (onExit) {
      server.removeListener("exit", onExit)
    }
  }
  return server
}

/**
 * Stops a mock backend started by {@link startServer} and waits for it to exit. Signals the
 * process group: tree-kill loses the node grandchild once an intermediate `pnpm` has exited,
 * leaving a listener on 4001/4002 that fails the next local run.
 */
async function stopServer(server: cp.ChildProcess | undefined): Promise<void> {
  if (server?.pid === undefined || server.exitCode !== null || server.signalCode !== null) {
    return
  }
  const exited = new Promise<void>((resolve) => {
    server.once("exit", () => resolve())
  })
  if (process.platform === "win32") {
    // taskkill /F /T, which does follow the whole tree.
    kill(server.pid, "SIGKILL")
  } else {
    try {
      process.kill(-server.pid, "SIGKILL")
    } catch {
      kill(server.pid, "SIGKILL")
    }
  }
  await Promise.race([
    exited,
    new Promise<void>((resolve) => {
      setTimeout(resolve, 5000)
    }),
  ])
}
