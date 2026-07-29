import * as cp from "child_process"
import * as path from "path"

import { expect } from "chai"
import { deleteSync } from "del"
import * as fs from "fs-extra"
import { first } from "lodash"
import kill from "tree-kill"
import type { Result } from "ts-results"

import Langs from "../api/langs"
import type { SubmissionFeedback } from "../api/types"
import { CLIENT_NAME, MINIMUM_SUBMISSION_INTERVAL, TMC_LANGS_VERSION } from "../config/constants"
import { AuthenticationError, AuthorizationError, BottleneckError, RuntimeError } from "../errors"
import { CourseIdentifier, ExerciseIdentifier } from "../shared/shared"
import { getLangsCLIForPlatform, getPlatform, semVerCompare } from "../utilities/"

// __dirname is the dist folder when built.
const PROJECT_ROOT = path.join(__dirname, "..")
const ARTIFACT_FOLDER = path.join(PROJECT_ROOT, "test-artifacts")

// Use CLI from backend folder to run tests.
const BACKEND_FOLDER = path.join(PROJECT_ROOT, "backend")
const CLI_PATH = path.join(BACKEND_FOLDER, "cli")
const CLI_FILE = path.join(CLI_PATH, getLangsCLIForPlatform(getPlatform(), TMC_LANGS_VERSION))
const FEEDBACK_URL = "http://localhost:4001/feedback"

// Example backend credentials
const USERNAME = "TestMyExtension"
const PASSWORD = "hunter2"

// Config dir name must follow conventions mandated by TMC-langs.
const CLIENT_CONFIG_DIR_NAME = `tmc-${CLIENT_NAME}`

const isString = (object: unknown): object is string => typeof object === "string"

// Some tests exercise the migration-client contract (--course-type, object
// CourseIdentifier, newer error kinds) that the released 0.39.4 CLI rejects.
// They run only when backend/cli holds a newer migration-branch CLI (installed
// via bin/useLocalLangs.bash) and skip gracefully against the released CLI so
// CI stays green. Detection uses the CLI's own reported version, not the
// filename — useLocalLangs.bash installs the local build under the pinned name.
const cliSupportsMigrationContract = ((): boolean => {
  try {
    const version = cp.execFileSync(CLI_FILE, ["--version"], { encoding: "utf-8" })
    const cmp = semVerCompare(version, "0.39.4", "patch")
    return cmp !== undefined && cmp > 0
  } catch (error) {
    console.warn(
      "Could not determine tmc-langs CLI version; skipping migration-contract tests:",
      error,
    )
    return false
  }
})()

// Use in place of `test` for migration-contract cases: runs on a local build,
// skips (with the reason logged above) against the released CLI.
const migrationTest = cliSupportsMigrationContract ? test : test.skip

suite("tmc langs cli spec", function () {
  let server: cp.ChildProcess | undefined

  suiteSetup(async function () {
    this.timeout(30000)
    // Route mooc (courses.mooc.fi) CLI calls at the mock mounted in the same
    // backend process (backend/mooc). This overrides the compiled
    // MOOC_BACKEND_URL define; _spawnLangsProcess reads it from the env and
    // passes it to the CLI child. Set before any Langs is constructed.
    process.env.TMC_LANGS_MOOC_ROOT_URL = "http://localhost:4001"
    // The mock defaults to requiring a bearer; opt this shared instance out
    // since the suite below drives resource endpoints without one (port 4002
    // covers the auth-required path).
    server = await startServer({ MOOC_MOCK_REQUIRE_AUTH: "0" })
  })

  let testDir: string

  setup(function () {
    let testDirName = this.currentTest?.fullTitle().replaceAll(/\s/g, "_")
    if (!testDirName) {
      throw new Error("Illegal function call.")
    }
    if (testDirName?.length > 72) {
      testDirName = testDirName.slice(0, 40) + ".." + testDirName.slice(testDirName.length - 30)
    }
    testDir = path.join(ARTIFACT_FOLDER, testDirName)
  })

  suite("authenticated user", function () {
    let configDir: string
    let onLoggedInCalls: number
    let onLoggedOutCalls: number
    let projectsDir: string
    let tmc: Langs

    setup(function () {
      configDir = path.join(testDir, CLIENT_CONFIG_DIR_NAME)
      writeCredentials(configDir)
      onLoggedInCalls = 0
      onLoggedOutCalls = 0
      projectsDir = setupProjectsDir(configDir, path.join(testDir, "tmcdata"))
      tmc = new Langs(CLI_FILE, CLIENT_NAME, "test", {
        cliConfigDir: testDir,
      })
      tmc.on("login", () => onLoggedInCalls++)
      tmc.on("logout", () => onLoggedOutCalls++)
    })

    test("should not be able to re-authenticate", async function () {
      const result = await tmc.authenticate(USERNAME, PASSWORD)
      expect(result.val).to.be.instanceOf(AuthenticationError)
    })

    test("should be able to deauthenticate", async function () {
      await unwrapResult(tmc.deauthenticate())
      expect(onLoggedOutCalls).to.be.equal(1)

      const result = await unwrapResult(tmc.isAuthenticated())
      expect(result).to.be.false

      expect(onLoggedInCalls).to.be.equal(0)
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
      const result = await tmc.downloadExercises([ExerciseIdentifier.from(1)], true, () => {})
      result.tmcError && expect.fail(`Expected operation to succeed: ${result.tmcError.message}`)
    }).timeout(10000)

    // Ids missing from the server are missing from the response.
    test.skip("should not be able to download a non-existent exercise", async function () {
      const { tmc: tmcDownloads } = await tmc.downloadExercises(
        [ExerciseIdentifier.from(404)],
        true,
        () => {},
      )
      expect(tmcDownloads.failed?.length).to.be.equal(1)
    })

    migrationTest("should get existing api data", async function () {
      const data = (await tmc.getTmcCourseData(1)).unwrap()
      expect(data.details.name).to.be.equal("python-course")
      expect(data.exercises.length).to.be.equal(2)
      expect(data.settings.name).to.be.equal("python-course")

      const details = (await tmc.getCourseDetails(CourseIdentifier.from(1))).unwrap()
      expect(details.id).to.be.equal(1)
      expect(details.name).to.be.equal("python-course")

      const exercises = (await tmc.getCourseExercises(1)).unwrap()
      expect(exercises.length).to.be.equal(2)

      const settings = (await tmc.getCourseSettings(1)).unwrap()
      expect(settings.name).to.be.equal("python-course")

      const courses = (await tmc.getCourses("test")).unwrap()
      expect(courses.length).to.be.equal(2)
      expect(courses.some((x) => x.name === "python-course")).to.be.true

      const exercise = (await tmc.getExerciseDetails(1)).unwrap()
      expect(exercise.exercise_name).to.be.equal("part01-01_passing_exercise")

      const submissions = (await tmc.getTmcOldSubmissions(1)).unwrap()
      expect(submissions.length).to.be.greaterThan(0)

      const organization = (await tmc.getOrganization("test")).unwrap()
      expect(organization.slug).to.be.equal("test")
      expect(organization.name).to.be.equal("Test Organization")

      const organizations = (await tmc.getTmcOrganizations()).unwrap()
      expect(organizations.length).to.be.equal(1, "Expected to get one organization.")
    })

    test("should encounter errors when trying to get non-existing api data", async function () {
      const dataResult = await tmc.getTmcCourseData(404)
      expect(dataResult.val).to.be.instanceOf(RuntimeError)

      const detailsResult = await tmc.getCourseDetails(CourseIdentifier.from(404))
      expect(detailsResult.val).to.be.instanceOf(RuntimeError)

      const exercisesResult = await tmc.getCourseExercises(404)
      expect(exercisesResult.val).to.be.instanceOf(RuntimeError)

      const settingsResult = await tmc.getCourseSettings(404)
      expect(settingsResult.val).to.be.instanceOf(RuntimeError)

      const coursesResult = await tmc.getCourses("404")
      expect(coursesResult.val).to.be.instanceOf(RuntimeError)

      const exerciseResult = await tmc.getExerciseDetails(404)
      expect(exerciseResult.val).to.be.instanceOf(RuntimeError)

      const submissionsResult = await tmc.getTmcOldSubmissions(404)
      expect(submissionsResult.val).to.be.instanceOf(RuntimeError)

      const result = await tmc.getOrganization("404")
      expect(result.val).to.be.instanceOf(RuntimeError)
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
        const { tmc: tmcRes } = await tmc.downloadExercises(
          [ExerciseIdentifier.from(1)],
          true,
          () => {},
        )
        const downloaded = tmcRes.downloaded[0]
        if (!downloaded) {
          throw new Error("expected an exercise to have been downloaded")
        }
        exercisePath = downloaded.path
      })

      test("should be able to clean the exercise", async function () {
        await unwrapResult(tmc.clean(exercisePath))
      })

      migrationTest("should be able to list local exercises", async function () {
        const result = await unwrapResult(tmc.listLocalCourseExercises("tmc", "python-course"))
        expect(result.length).to.be.equal(1)
        expect(first(result)?.["exercise-path"]).to.be.equal(exercisePath)
      })

      test("should be able to run tests for exercise", async function () {
        const result = await unwrapResult(tmc.runTests(exercisePath).process)
        expect(result.status).to.be.equal("PASSED")
      })

      test("should be able to migrate the exercise to langs projects directory", async function () {
        // By changing projects directory path, the exercise is no longer there. Therefore
        // it can be "migrated".
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
        const result = await unwrapResult(tmc.checkTmcExerciseUpdates())
        expect(result.length).to.be.equal(0)
      })

      test("should be able to save the exercise state and revert it to an old submission", async function () {
        const submissions = await unwrapResult(tmc.getTmcOldSubmissions(1))
        await unwrapResult(tmc.downloadTmcOldSubmission(1, exercisePath, 1, true))

        // State saving check is based on a side effect of making a new submission.
        const newSubmissions = await unwrapResult(tmc.getTmcOldSubmissions(1))
        expect(newSubmissions.length).to.be.equal(submissions.length + 1)
      })

      test("should be able to download an old submission without saving the current state", async function () {
        const submissions = await unwrapResult(tmc.getTmcOldSubmissions(1))
        await unwrapResult(tmc.downloadTmcOldSubmission(1, exercisePath, 1, false))

        // State saving check is based on a side effect of making a new submission.
        const newSubmissions = await unwrapResult(tmc.getTmcOldSubmissions(1))
        expect(newSubmissions.length).to.be.equal(submissions.length)
      })

      // Langs fails to remove folder on Windows CI
      test.skip("should be able to save the exercise state and reset it to original template", async function () {
        const submissions = await unwrapResult(tmc.getTmcOldSubmissions(1))
        await unwrapResult(tmc.resetExercise(ExerciseIdentifier.from(1), exercisePath, true))

        // State saving check is based on a side effect of making a new submission.
        const newSubmissions = await unwrapResult(tmc.getTmcOldSubmissions(1))
        expect(newSubmissions.length).to.be.equal(submissions.length + 1)
      })

      // Langs fails to remove folder on Windows CI
      test.skip("should be able to reset exercise without saving the current state", async function () {
        const submissions = await unwrapResult(tmc.getTmcOldSubmissions(1))
        await unwrapResult(tmc.resetExercise(ExerciseIdentifier.from(1), exercisePath, false))

        // State saving check is based on a side effect of making a new submission.
        const newSubmissions = await unwrapResult(tmc.getTmcOldSubmissions(1))
        expect(newSubmissions.length).to.be.equal(submissions.length)
      })

      test("should be able to submit the exercise for evaluation", async function () {
        let url: string | undefined
        const results = await unwrapResult(
          tmc.submitTmcExerciseAndWaitForResults(
            ExerciseIdentifier.from(1),
            exercisePath,
            undefined,
            (x) => (url = x),
          ),
        )
        expect(results.status).to.be.equal("ok")
        !url && expect.fail("expected to receive submission url during submission.")
      })

      test("should encounter an error if trying to submit the exercise twice too soon", async function () {
        const firstSubmission = tmc.submitTmcExerciseAndWaitForResults(
          ExerciseIdentifier.from(1),
          exercisePath,
        )
        const second = tmc.submitTmcExerciseAndWaitForResults(
          ExerciseIdentifier.from(1),
          exercisePath,
        )
        const [, secondResult] = await Promise.all([firstSubmission, second])
        expect(secondResult.val).to.be.instanceOf(BottleneckError)
      })

      test("should be able to submit the exercise to TMC-paste", async function () {
        const pasteUrl = await unwrapResult(tmc.submitTmcExerciseToPaste(1, exercisePath))
        expect(pasteUrl).to.include("localhost")
      })

      test("should encounter an error if trying to submit to paste twice too soon", async function () {
        const firstSubmission = tmc.submitTmcExerciseToPaste(1, exercisePath)
        const second = tmc.submitTmcExerciseToPaste(1, exercisePath)
        const [, secondResult] = await Promise.all([firstSubmission, second])
        expect(secondResult.val).to.be.instanceOf(BottleneckError)
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
        const result = await tmc.downloadTmcOldSubmission(1, missingExercisePath, 1, false)
        expect(result.val).to.be.instanceOf(RuntimeError)
      })

      test("should encounter an error when trying to reset it", async function () {
        const result = await tmc.resetExercise(
          ExerciseIdentifier.from(1),
          missingExercisePath,
          false,
        )
        expect(result.val).to.be.instanceOf(RuntimeError)
      })

      test("should encounter an error when trying to submit it", async function () {
        const result = await tmc.submitTmcExerciseAndWaitForResults(
          ExerciseIdentifier.from(1),
          missingExercisePath,
        )
        expect(result.val).to.be.instanceOf(RuntimeError)
      })

      test("should encounter an error when trying to submit it to TMC-paste", async function () {
        const result = await tmc.submitTmcExerciseToPaste(404, missingExercisePath)
        expect(result.val).to.be.instanceOf(RuntimeError)
      })
    })
  })

  suite("unauthenticated user", function () {
    let onLoggedInCalls: number
    let onLoggedOutCalls: number
    let configDir: string
    let projectsDir: string
    let tmc: Langs

    setup(function () {
      configDir = path.join(testDir, CLIENT_CONFIG_DIR_NAME)
      clearCredentials(configDir)
      onLoggedInCalls = 0
      onLoggedOutCalls = 0
      projectsDir = setupProjectsDir(configDir, path.join(testDir, "tmcdata"))
      tmc = new Langs(CLI_FILE, CLIENT_NAME, "test", {
        cliConfigDir: testDir,
      })
      tmc.on("login", () => onLoggedInCalls++)
      tmc.on("logout", () => onLoggedOutCalls++)
    })

    // TODO: There was something fishy with this test
    test("should not be able to authenticate with empty credentials", async function () {
      const result = await tmc.authenticate("", "")
      expect(result.val).to.be.instanceOf(AuthenticationError)
    })

    test("should not be able to authenticate with incorrect credentials", async function () {
      const result = await tmc.authenticate(USERNAME, "batman123")
      expect(result.val).to.be.instanceOf(AuthenticationError)
    })

    test("should be able to authenticate with correct credentials", async function () {
      await unwrapResult(tmc.authenticate(USERNAME, PASSWORD))
      expect(onLoggedInCalls).to.be.equal(1)

      const result2 = await unwrapResult(tmc.isAuthenticated())
      expect(result2).to.be.true

      expect(onLoggedOutCalls).to.be.equal(0)
    })

    test("should not be able to download an exercise", async function () {
      const result = await tmc.downloadExercises([ExerciseIdentifier.from(1)], true, () => {})
      expect(result.tmcError).to.be.instanceOf(RuntimeError)
    })

    // The mock backend doesn't enforce auth, so unauthenticated calls surface as
    // the CLI's generic errors (RuntimeError), not backend authorization errors.
    migrationTest("should not get existing api data in general", async function () {
      const dataResult = await tmc.getTmcCourseData(0)
      expect(dataResult.val).to.be.instanceOf(RuntimeError)

      const detailsResult = await tmc.getCourseDetails(CourseIdentifier.from(0))
      expect(detailsResult.val).to.be.instanceOf(RuntimeError)

      const exercisesResult = await tmc.getCourseExercises(0)
      expect(exercisesResult.val).to.be.instanceOf(RuntimeError)

      const settingsResult = await tmc.getCourseSettings(0)
      expect(settingsResult.val).to.be.instanceOf(RuntimeError)

      const coursesResult = await tmc.getCourses("test")
      expect(coursesResult.val).to.be.instanceOf(RuntimeError)

      const exerciseResult = await tmc.getExerciseDetails(1)
      expect(exerciseResult.val).to.be.instanceOf(RuntimeError)

      const submissionsResult = await tmc.getTmcOldSubmissions(1)
      expect(submissionsResult.val).to.be.instanceOf(RuntimeError)
    })

    test("should be able to get valid organization data", async function () {
      const organization = await unwrapResult(tmc.getOrganization("test"))
      expect(organization.slug).to.be.equal("test")
      expect(organization.name).to.be.equal("Test Organization")

      const organizations = await unwrapResult(tmc.getTmcOrganizations())
      expect(organizations.length).to.be.equal(1, "Expected to get one organization.")
    })

    test("should encounter error if trying to get non-existing organization data", async function () {
      const result = await tmc.getOrganization("404")
      expect(result.val).to.be.instanceOf(RuntimeError)
    })

    migrationTest("should not be able to give feedback", async function () {
      const feedback: SubmissionFeedback = {
        status: [{ question_id: 0, answer: "42" }],
      }
      const result = await tmc.submitSubmissionFeedback(FEEDBACK_URL, feedback)
      expect(result.val).to.be.instanceOf(RuntimeError)
    })

    suite("with a local exercise", function () {
      this.timeout(20000)

      let exercisePath: string

      setup(async function () {
        deleteSync(projectsDir, { force: true })
        writeCredentials(configDir)
        const { tmc: tmcRes } = await tmc.downloadExercises(
          [ExerciseIdentifier.from(1)],
          true,
          () => {},
        )
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

      migrationTest("should be able to list local exercises", async function () {
        const result = await unwrapResult(tmc.listLocalCourseExercises("tmc", "python-course"))
        expect(result.length).to.be.equal(1)
        expect(first(result)?.["exercise-path"]).to.be.equal(exercisePath)
      })

      test("should be able to run tests for exercise", async function () {
        const result = await unwrapResult(tmc.runTests(exercisePath).process)
        expect(result.status).to.be.equal("PASSED")
      })

      test("should not be able to load old submission", async function () {
        const result = await tmc.downloadTmcOldSubmission(1, exercisePath, 1, true)
        expect(result.val).to.be.instanceOf(RuntimeError)
      })

      migrationTest("should not be able to reset exercise", async function () {
        const result = await tmc.resetExercise(ExerciseIdentifier.from(1), exercisePath, true)
        expect(result.val).to.be.instanceOf(RuntimeError)
      })

      migrationTest("should not be able to submit exercise", async function () {
        const result = await tmc.submitTmcExerciseAndWaitForResults(
          ExerciseIdentifier.from(1),
          exercisePath,
        )
        expect(result.val).to.be.instanceOf(RuntimeError)
      })

      // This actually works
      test.skip("should not be able to submit exercise to TMC-paste", async function () {
        const result = await tmc.submitTmcExerciseToPaste(1, exercisePath)
        expect(result.val).to.be.instanceOf(AuthorizationError)
      })
    })
  })

  // courses.mooc.fi mock (backend/mooc). All cases are migration-contract
  // (mooc subcommands + UUID ids) that the released 0.39.4 CLI lacks, so they
  // run only against a locally-built CLI (migrationTest) and skip on CI's
  // released CLI -- keeping CI green. Fixture ids are the fixed UUIDs from
  // backend/mooc/fixtures.ts.
  suite("mooc backend", function () {
    this.timeout(20000)

    // fixed fixture ids (backend/mooc/fixtures.ts)
    const PYTHON_COURSE_ID = "11111111-1111-4111-8111-111111111111"
    const PASSING_EXERCISE_ID = "a1a1a1a1-0000-4000-8000-000000000001"
    const FAILING_EXERCISE_ID = "b2b2b2b2-0000-4000-8000-000000000001"
    const NONEXISTENT_EXERCISE_ID = "ffffffff-0000-4000-8000-000000000000"

    let configDir: string
    let tmc: Langs

    setup(function () {
      configDir = path.join(testDir, CLIENT_CONFIG_DIR_NAME)
      writeCredentials(configDir)
      const projectsDir = path.join(testDir, "tmcdata")
      deleteSync(projectsDir, { force: true })
      setupProjectsDir(configDir, projectsDir)
      // Poll grading fast so the blocking submit tests don't wait the real ~2 s
      // interval; the CLI inherits process.env (see Langs._spawnLangsProcess).
      process.env.TMC_LANGS_MOOC_POLL_INTERVAL_MS = "50"
      tmc = new Langs(CLI_FILE, CLIENT_NAME, "test", { cliConfigDir: testDir })
    })

    migrationTest("should list the enrolled mooc courses", async function () {
      const courses = (await tmc.getEnrolledMoocCourseInstances()).unwrap()
      expect(courses.length).to.be.equal(2)
      expect(courses.some((c) => c.name === "MOOC Python Course")).to.be.true
    })

    migrationTest("should get mooc course data with exercise slides", async function () {
      const [course, slides] = (await tmc.getMoocCourseInstanceData(PYTHON_COURSE_ID)).unwrap()
      expect(course.name).to.be.equal("MOOC Python Course")
      expect(slides.length).to.be.equal(1)
      expect(slides[0]?.exercise_id).to.be.equal(PASSING_EXERCISE_ID)
      expect(slides[0]?.tasks[0]?.public_spec).to.not.be.undefined
    })

    // Writes a minimal submittable python project (the `requirements.txt` marker
    // makes tmc-langs recognise it) and returns its path.
    const writeSubmittableProject = (name: string): string => {
      const dir = path.join(testDir, name)
      fs.mkdirSync(path.join(dir, "src"), { recursive: true })
      fs.writeFileSync(path.join(dir, "requirements.txt"), "")
      fs.writeFileSync(path.join(dir, "src", "main.py"), "print('hi')\n")
      return dir
    }

    migrationTest(
      "should submit a mooc exercise and block for a fully-graded result",
      async function () {
        const dir = writeSubmittableProject("mooc-submit-passing")
        const status = (
          await tmc.submitMoocExerciseAndWaitForResults(PASSING_EXERCISE_ID, dir)
        ).unwrap()
        // the blocking submit resolves slide/task from the exercise id, polls the
        // grading through the real CLI, and returns a terminal FullyGraded status
        expect(status).to.not.equal("NoGradingYet")
        if (status === "NoGradingYet") {
          throw new Error("unreachable")
        }
        expect(status.Grading.grading_progress).to.equal("FullyGraded")
        expect(status.Grading.score_given).to.equal(1)
      },
    )

    migrationTest("should submit a failing mooc exercise and report Failed", async function () {
      const dir = writeSubmittableProject("mooc-submit-failing")
      const status = (
        await tmc.submitMoocExerciseAndWaitForResults(FAILING_EXERCISE_ID, dir)
      ).unwrap()
      expect(status).to.not.equal("NoGradingYet")
      if (status === "NoGradingYet") {
        throw new Error("unreachable")
      }
      expect(status.Grading.grading_progress).to.equal("Failed")
      expect(status.Grading.score_given).to.equal(0)
    })

    migrationTest(
      "should submit a mooc exercise to paste and return a share URL",
      async function () {
        const dir = writeSubmittableProject("mooc-paste")
        // `mooc paste` submits (non-blocking) then shares the resulting submission,
        // resolving the slide-submission id from the exercise's submissions list.
        const pasteUrl = (await tmc.submitMoocExerciseToPaste(PASSING_EXERCISE_ID, dir)).unwrap()
        expect(pasteUrl).to.match(/\/shared-submissions\/[0-9a-f-]+$/)
      },
    )

    migrationTest("should download mooc exercises then skip them by checksum", async function () {
      const ids = [
        ExerciseIdentifier.from(PASSING_EXERCISE_ID),
        ExerciseIdentifier.from(FAILING_EXERCISE_ID),
      ]
      const { mooc: firstMooc } = await tmc.downloadExercises(ids, false, () => {})
      expect(firstMooc.downloaded.length).to.be.equal(2)
      expect(firstMooc.skipped.length).to.be.equal(0)

      // second run: identical checksums -> skipped, nothing re-downloaded
      const { mooc: secondMooc } = await tmc.downloadExercises(ids, false, () => {})
      expect(secondMooc.downloaded.length).to.be.equal(0)
      expect(secondMooc.skipped.length).to.be.equal(2)
    })

    migrationTest(
      "should report a failed entry for a nonexistent mooc exercise",
      async function () {
        const { mooc } = await tmc.downloadExercises(
          [ExerciseIdentifier.from(NONEXISTENT_EXERCISE_ID)],
          false,
          () => {},
        )
        expect(mooc.failed?.length).to.be.equal(1)
      },
    )

    migrationTest(
      "should key mooc download results by the requested exercise id",
      async function () {
        // Regression guard for the task_id/exercise_id confusion: the result must
        // be addressable by the exercise id the caller passed in.
        const { mooc } = await tmc.downloadExercises(
          [ExerciseIdentifier.from(PASSING_EXERCISE_ID)],
          false,
          () => {},
        )
        expect(mooc.downloaded.length).to.be.equal(1)
        expect(mooc.downloaded[0]?.["exercise-id"]).to.be.equal(PASSING_EXERCISE_ID)
      },
    )

    migrationTest(
      "should download with --course-id and then list the local mooc exercise with its slug",
      async function () {
        // Passing the course id drives the single-course resolution path; the
        // downloaded exercise must then surface via the mooc list-local command
        // (looked up by course id) with a slug + path so the workspace manager
        // can track it.
        const downloaded = await tmc.downloadExercises(
          [ExerciseIdentifier.from(PASSING_EXERCISE_ID)],
          false,
          () => {},
          PYTHON_COURSE_ID,
        )
        expect(downloaded.mooc.downloaded.length).to.be.equal(1)

        const local = (await tmc.listLocalCourseExercises("mooc", PYTHON_COURSE_ID)).unwrap()
        const entry = local.find(
          (x) => "exercise-id" in x && x["exercise-id"] === PASSING_EXERCISE_ID,
        )
        expect(entry, "the downloaded exercise should be listed locally").to.not.be.undefined
        expect(entry?.["exercise-slug"]).to.be.a("string").and.not.be.empty
        expect(entry?.["exercise-path"]).to.be.a("string").and.not.be.empty
      },
    )

    migrationTest(
      "should submit twice, list both newest-first, and restore an old submission",
      async function () {
        // Get a real local exercise path to submit and restore into.
        await tmc.downloadExercises(
          [ExerciseIdentifier.from(PASSING_EXERCISE_ID)],
          false,
          () => {},
          PYTHON_COURSE_ID,
        )
        const local = (await tmc.listLocalCourseExercises("mooc", PYTHON_COURSE_ID)).unwrap()
        const entry = local.find(
          (x) => "exercise-id" in x && x["exercise-id"] === PASSING_EXERCISE_ID,
        )
        const exercisePath = (entry as { "exercise-path": string })["exercise-path"]
        const studentFile = path.join(exercisePath, "src", "passing_exercise.py")
        expect(fs.existsSync(studentFile)).to.be.true

        // The mock accumulates submissions for the suite's lifetime, so measure
        // relative to whatever is already there.
        const before = (await tmc.getMoocOldSubmissions(PASSING_EXERCISE_ID)).unwrap()

        // Make the two submissions CONTENT-DISTINCT so restoring the older one is
        // provably serving that submission's own content -- not the exercise stub
        // and not the newer submission. The stub content is what's on disk right
        // after download; the two submissions each get a distinct marker.
        const stubContent = fs.readFileSync(studentFile, "utf8")
        const olderContent = `${stubContent}\n# older submission marker (restore target)\n`
        const newerContent = `${stubContent}\n# newer submission marker (must not be restored)\n`
        expect(olderContent).to.not.equal(newerContent)
        expect(olderContent).to.not.equal(stubContent)

        // Two submissions of the same exercise. The CLI compresses the on-disk
        // directory into the submitted archive, so each submission captures the
        // student file content at submit time. Consecutive submits within
        // MINIMUM_SUBMISSION_INTERVAL are throttled by design (the TMC suite
        // asserts the BottleneckError), so wait the interval out in between.
        fs.writeFileSync(studentFile, olderContent)
        ;(await tmc.submitMoocExerciseAndWaitForResults(PASSING_EXERCISE_ID, exercisePath)).unwrap()
        await new Promise((resolve) => {
          setTimeout(resolve, MINIMUM_SUBMISSION_INTERVAL + 100)
        })
        fs.writeFileSync(studentFile, newerContent)
        ;(await tmc.submitMoocExerciseAndWaitForResults(PASSING_EXERCISE_ID, exercisePath)).unwrap()

        const after = (await tmc.getMoocOldSubmissions(PASSING_EXERCISE_ID)).unwrap()
        expect(after.length).to.be.equal(before.length + 2)
        // newest first: the two we just submitted lead the list, distinct ids,
        // and created_at is non-increasing down the list
        expect(after[0]?.id).to.not.equal(after[1]?.id)
        for (let i = 1; i < after.length; i++) {
          expect(new Date(after[i - 1]!.created_at).getTime()).to.be.at.least(
            new Date(after[i]!.created_at).getTime(),
          )
        }

        // Downloading the OLDER of the two must restore the OLDER submission's
        // content. Overwrite the file with the newer content first (as it is on
        // disk after the second submit), then restore the older submission and
        // assert we got the older content back -- not the newer one, and not the
        // stub.
        const olderId = after[1]!.id
        fs.writeFileSync(studentFile, newerContent)
        ;(
          await tmc.downloadMoocOldSubmission(PASSING_EXERCISE_ID, exercisePath, olderId, false)
        ).unwrap()
        expect(fs.existsSync(studentFile)).to.be.true
        const restored = fs.readFileSync(studentFile, "utf8")
        expect(restored).to.equal(olderContent)
        expect(restored).to.not.equal(newerContent)
        expect(restored).to.not.equal(stubContent)
      },
    )

    migrationTest("reports mooc login status from the stored credentials file", async function () {
      // `mooc logged-in` only reads credentials_mooc.json; no backend call.
      clearMoocCredentials(configDir)
      expect((await tmc.isMoocAuthenticated()).unwrap()).to.be.false
      writeMoocCredentials(configDir)
      expect((await tmc.isMoocAuthenticated()).unwrap()).to.be.true
    })

    migrationTest("deauthenticateMooc removes the stored mooc credentials", async function () {
      writeMoocCredentials(configDir)
      expect((await tmc.isMoocAuthenticated()).unwrap()).to.be.true
      ;(await tmc.deauthenticateMooc()).unwrap()
      expect((await tmc.isMoocAuthenticated()).unwrap()).to.be.false
    })

    migrationTest(
      "authenticateMooc runs the device flow and stores credentials",
      async function () {
        clearMoocCredentials(configDir)
        // Poll fast; the mock only approves the pending grant after ~5s of
        // wall-clock time (backend/mooc/oauth.ts).
        process.env.TMC_LANGS_MOOC_DEVICE_POLL_INTERVAL_MS = "50"
        let deviceInfo: { user_code: string; verification_uri: string } | undefined
        const { result } = tmc.authenticateMooc((info) => {
          deviceInfo = info
        })
        const res = await result
        expect(res.ok, res.err ? `login failed: ${res.val.message}` : "").to.be.true
        // the CLI emitted the device code before blocking on the poll loop
        expect(deviceInfo?.user_code).to.equal("WXYZ-1234")
        expect(deviceInfo?.verification_uri).to.contain("/oauth_device")
        expect((await tmc.isMoocAuthenticated()).unwrap()).to.be.true
      },
    )
  })

  // Second mock with bearer validation ON, reached via
  // TMC_LANGS_MOOC_TRUST_LOCALHOST=1 (without it the CLI never attaches a
  // bearer to localhost). Pins the 401/403 -> refresh-retry/delete path.
  suite("mooc backend (bearer auth)", function () {
    this.timeout(30000)

    const AUTH_PORT = 4002
    const AUTH_BASE = `http://localhost:${AUTH_PORT}`
    // Tokens the auth-mode mock recognises (backend/mooc/oauth.ts).
    const SEEDED_ACCESS_TOKEN = "mock-seeded-access-token"
    const INVALID_REFRESH_TOKEN = "mock-invalid-refresh-token"

    let authServer: cp.ChildProcess | undefined
    let configDir: string
    let savedRootUrl: string | undefined
    let savedTrust: string | undefined
    let tmc: Langs

    suiteSetup(async function () {
      // All cases skip against the released CLI, so skip starting the mock too.
      if (!cliSupportsMigrationContract) {
        return
      }
      this.timeout(30000)
      authServer = await startServer({
        PORT: String(AUTH_PORT),
        MOOC_MOCK_REQUIRE_AUTH: "1",
        MOOC_MOCK_BASE_URL: AUTH_BASE,
      })
    })

    setup(function () {
      // Trust localhost so the CLI actually attaches a bearer; env vars are
      // saved/restored so the other suites (auth-less 4001 mock) are unaffected.
      savedRootUrl = process.env.TMC_LANGS_MOOC_ROOT_URL
      savedTrust = process.env.TMC_LANGS_MOOC_TRUST_LOCALHOST
      process.env.TMC_LANGS_MOOC_ROOT_URL = AUTH_BASE
      process.env.TMC_LANGS_MOOC_TRUST_LOCALHOST = "1"
      configDir = path.join(testDir, CLIENT_CONFIG_DIR_NAME)
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

    suiteTeardown(function () {
      authServer && kill(authServer.pid as number)
      authServer?.kill()
    })

    migrationTest(
      "attaches the bearer to a resource call and succeeds; the mock records it",
      async function () {
        writeMoocCredentials(configDir, { accessToken: SEEDED_ACCESS_TOKEN })
        const courses = (await tmc.getEnrolledMoocCourseInstances()).unwrap()
        expect(courses.length).to.be.greaterThan(0)
        // Cross-process proof the CLI attached the bearer; without
        // TMC_LANGS_MOOC_TRUST_LOCALHOST this call would have 401'd.
        const state = (await (await fetch(`${AUTH_BASE}/mooc-mock/auth-state`)).json()) as {
          lastAuthorization: string
          authenticatedRequestCount: number
        }
        expect(state.lastAuthorization).to.equal(`Bearer ${SEEDED_ACCESS_TOKEN}`)
        expect(state.authenticatedRequestCount).to.be.greaterThan(0)
      },
    )

    migrationTest(
      "refreshes an expired stored token, then retries without a visible auth error",
      async function () {
        writeMoocCredentials(configDir, {
          // Unrecognised token; the expired lifetime forces the CLI's proactive
          // refresh before the resource call.
          accessToken: "mock-access-expired",
          // Any non-sentinel value; the mock's refresh grant mints a fresh
          // valid access token from it.
          refreshToken: "mock-refresh-valid",
          expiresIn: 3600,
          obtainedAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
        })
        const courses = (await tmc.getEnrolledMoocCourseInstances()).unwrap()
        expect(courses.length).to.be.greaterThan(0)
        // The refreshed credentials were retained -> still logged in.
        expect((await tmc.isMoocAuthenticated()).unwrap()).to.be.true
      },
    )

    migrationTest(
      "deletes credentials and reports logged-out when the refresh is rejected",
      async function () {
        writeMoocCredentials(configDir, {
          accessToken: "mock-access-expired",
          // The sentinel the mock rejects with a permanent `invalid_grant`.
          refreshToken: INVALID_REFRESH_TOKEN,
          expiresIn: 3600,
          obtainedAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
        })
        expect((await tmc.isMoocAuthenticated()).unwrap()).to.be.true
        // Refresh is rejected, so langs deletes the creds and proceeds unauthenticated.
        const res = await tmc.getEnrolledMoocCourseInstances()
        expect(res.err).to.be.true
        expect((await tmc.isMoocAuthenticated()).unwrap()).to.be.false
      },
    )
  })

  suiteTeardown(function () {
    server && kill(server.pid as number)
    // the command above didn't seem to work reliably, so the call below was added
    server?.kill()
  })
})

function writeCredentials(configDir: string): void {
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true })
  }
  fs.writeFileSync(
    path.join(configDir, "credentials.json"),
    '{"access_token":"1234","token_type":"bearer","scope":"public"}',
  )
}

function clearCredentials(configDir: string): void {
  deleteSync(path.join(configDir, "credentials.json"), { force: true })
}

// Seeds credentials_mooc.json as a successful `mooc login` would, skipping the
// device flow. Mirrors the stored `{token, obtained_at}` wrapper (token is a
// serialized oauth2 StandardTokenResponse); kept separate from the legacy
// `credentials.json` that `writeCredentials` seeds.
function writeMoocCredentials(
  configDir: string,
  options?: {
    accessToken?: string
    refreshToken?: string
    expiresIn?: number
    // Defaults to now; a past value plus `expiresIn` makes the token
    // already-expired, forcing a refresh on the next command.
    obtainedAt?: string
  },
): void {
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true })
  }
  const token: Record<string, unknown> = {
    access_token: options?.accessToken ?? "mooc-access-token",
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
    path.join(configDir, "credentials_mooc.json"),
    JSON.stringify({ token, obtained_at: options?.obtainedAt ?? new Date().toISOString() }),
  )
}

function clearMoocCredentials(configDir: string): void {
  deleteSync(path.join(configDir, "credentials_mooc.json"), { force: true })
}

function setupProjectsDir(configDir: string, projectsDir: string): string {
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true })
  }
  fs.writeFileSync(path.join(configDir, "config.toml"), `projects-dir = '${projectsDir}'\n`)
  return projectsDir
}

async function unwrapResult<T>(result: Promise<Result<T, Error>>): Promise<T> {
  const res = await result
  if (res.err) {
    expect.fail(`TMC-langs execution failed: ${res.val.message}`)
  }
  return res.val
}

async function startServer(extraEnv: Record<string, string> = {}): Promise<cp.ChildProcess> {
  let ready = false
  const backendPath = path.join(__dirname, "..", "backend")
  console.log("Running pnpm start at", backendPath, "with env", extraEnv)
  const server = cp.spawn("pnpm", ["start"], {
    cwd: backendPath,
    shell: "bash",
    env: { ...process.env, ...extraEnv },
  })
  console.info("[server] starting...")
  server.stdout.on("data", (chunk) => {
    console.info(`[server] ${chunk.toString()}`)
    if (chunk.toString().startsWith("Server listening to")) {
      ready = true
    }
  })

  const timeout = setTimeout(() => {
    throw new Error("Failed to start server")
  }, 20000)

  // oxlint-disable-next-line no-unmodified-loop-condition -- `ready` is flipped by the server's stdout listener while we poll
  while (!ready) {
    await new Promise((resolve) => {
      setTimeout(resolve, 1000)
    })
  }

  clearTimeout(timeout)
  return server
}
