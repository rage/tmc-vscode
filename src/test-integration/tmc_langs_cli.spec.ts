import { expect } from "chai";
import * as cp from "child_process";
import { sync as delSync } from "del";
import * as fs from "fs-extra";
import { ncp } from "ncp";
import * as path from "path";
import * as kill from "tree-kill";

import TMC from "../api/tmc";
import { SubmissionFeedback } from "../api/types";
import { CLIENT_NAME, TMC_LANGS_VERSION } from "../config/constants";
import { AuthenticationError, AuthorizationError, BottleneckError, RuntimeError } from "../errors";
import { getLangsCLIForPlatform, getPlatform } from "../utils/";

// __dirname is the dist folder when executed.
const PROJECT_ROOT = path.join(__dirname, "..");
const ARTIFACT_FOLDER = path.join(PROJECT_ROOT, "test-artifacts", "tmc_langs_cli_spec");

// Use CLI from backend folder to run tests.
const BACKEND_FOLDER = path.join(PROJECT_ROOT, "backend");
const CLI_PATH = path.join(BACKEND_FOLDER, "cli");
const CLI_FILE = path.join(CLI_PATH, getLangsCLIForPlatform(getPlatform(), TMC_LANGS_VERSION));
const COURSE_PATH = path.join(BACKEND_FOLDER, "resources", "test-python-course");
const PASSING_EXERCISE_PATH = path.join(COURSE_PATH, "part01-01_passing_exercise");
const MISSING_EXERCISE_PATH = path.join(COURSE_PATH, "part01-404_missing_exercise");
const FEEDBACK_URL = "http://localhost:4001/feedback";

// This one is mandated by TMC-langs.
const CLIENT_CONFIG_DIR_NAME = `tmc-${CLIENT_NAME}`;

async function startServer(): Promise<cp.ChildProcess> {
    let ready = false;
    console.log(path.join(__dirname, "..", "backend"));
    const server = cp.spawn("npm", ["start"], {
        cwd: path.join(__dirname, "..", "backend"),
        shell: "bash",
    });
    server.stdout.on("data", (chunk) => {
        if (chunk.toString().startsWith("Server listening to")) {
            ready = true;
        }
    });

    const timeout = setTimeout(() => {
        throw new Error("Failed to start server");
    }, 20000);

    while (!ready) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    clearTimeout(timeout);
    return server;
}

function setupProjectsDir(dirName: string): string {
    const authenticatedConfigDir = path.join(ARTIFACT_FOLDER, CLIENT_CONFIG_DIR_NAME);
    if (!fs.existsSync(authenticatedConfigDir)) {
        fs.mkdirSync(authenticatedConfigDir, { recursive: true });
    }
    const projectsDir = path.join(ARTIFACT_FOLDER, dirName);
    fs.writeFileSync(
        path.join(authenticatedConfigDir, "config.toml"),
        `projects-dir = '${projectsDir}'\n`,
    );
    return projectsDir;
}

suite("TMC", function () {
    let server: cp.ChildProcess | undefined;

    suiteSetup(async function () {
        this.timeout(30000);
        server = await startServer();
    });

    let tmc: TMC;
    let tmcUnauthenticated: TMC;

    setup(function () {
        const authenticatedConfigDir = path.join(ARTIFACT_FOLDER, CLIENT_CONFIG_DIR_NAME);
        if (!fs.existsSync(authenticatedConfigDir)) {
            fs.mkdirSync(authenticatedConfigDir, { recursive: true });
        }
        fs.writeFileSync(
            path.join(authenticatedConfigDir, "credentials.json"),
            '{"access_token":"1234","token_type":"bearer","scope":"public"}',
        );
        tmc = new TMC(CLI_FILE, CLIENT_NAME, "test", {
            cliConfigDir: ARTIFACT_FOLDER,
        });

        const unauthenticatedArtifactFolder = path.join(ARTIFACT_FOLDER, "__unauthenticated");
        const unauthenticatedConfigDir = path.join(
            unauthenticatedArtifactFolder,
            CLIENT_CONFIG_DIR_NAME,
        );
        delSync(unauthenticatedConfigDir, { force: true });
        tmcUnauthenticated = new TMC(CLI_FILE, CLIENT_NAME, "test", {
            cliConfigDir: unauthenticatedConfigDir,
        });
    });

    suite("authenticate()", function () {
        test.skip("should result in AuthenticationError with empty credentials", async function () {
            const result = await tmcUnauthenticated.authenticate("", "");
            expect(result.val).to.be.instanceOf(AuthenticationError);
        });

        test("should result in AuthenticationError with incorrect credentials", async function () {
            const result = await tmcUnauthenticated.authenticate("TestMyCode", "hunter2");
            expect(result.val).to.be.instanceOf(AuthenticationError);
        });

        test("should succeed with correct credentials", async function () {
            const result = await tmcUnauthenticated.authenticate("TestMyExtension", "hunter2");
            expect(result.ok).to.be.true;
        });

        test("should result in AuthenticationError when already authenticated", async function () {
            const result = await tmc.authenticate("TestMyExtension", "hunter2");
            expect(result.val).to.be.instanceOf(AuthenticationError);
        });
    });

    suite("isAuthenticated()", function () {
        test("should return false when user config is missing", async function () {
            const result = await tmcUnauthenticated.isAuthenticated();
            expect(result.val).to.be.false;
        });

        test("should return true when user config exists", async function () {
            const result = await tmc.isAuthenticated();
            expect(result.val).to.be.true;
        });
    });

    suite("deauthenticate()", function () {
        test("should deauthenticate the user", async function () {
            const result = await tmc.deauthenticate();
            expect(result.ok).to.be.true;
        });
    });

    suite("clean()", function () {
        test("should clean the exercise", async function () {
            const result = (await tmc.clean(PASSING_EXERCISE_PATH)).unwrap();
            expect(result).to.be.undefined;
        });

        test("should result in RuntimeError for nonexistent exercise", async function () {
            const result = await tmc.clean(MISSING_EXERCISE_PATH);
            expect(result.val).to.be.instanceOf(RuntimeError);
        });
    });

    suite("runTests()", function () {
        test("should return test results", async function () {
            const result = (await tmc.runTests(PASSING_EXERCISE_PATH)[0]).unwrap();
            expect(result.status).to.be.equal("PASSED");
        }).timeout(20000);

        test("should result in RuntimeError for nonexistent exercise", async function () {
            const result = await tmc.runTests(MISSING_EXERCISE_PATH)[0];
            expect(result.val).to.be.instanceOf(RuntimeError);
        });
    });

    suite("downloadExercises()", function () {
        this.timeout(5000);

        setup(function () {
            const projectsDir = setupProjectsDir("downloadExercises");
            delSync(projectsDir, { force: true });
        });

        // Current langs version returns generic error so handling fails
        test.skip("should result in AuthorizationError if not authenticated", async function () {
            const result = await tmcUnauthenticated.downloadExercises([1], () => {});
            expect(result.val).to.be.instanceOf(AuthorizationError);
        });

        test("should download exercise", async function () {
            const result = await tmc.downloadExercises([1], () => {});
            if (result.err) {
                expect.fail(result.val.message + ": " + result.val.stack);
            }
        });
    });

    suite("downloadOldSubmission()", function () {
        this.timeout(5000);

        let exercisePath: string;

        setup(function () {
            const projectsDir = setupProjectsDir("downloadOldSubmission");
            exercisePath = path.join(projectsDir, "part01-01_passing_exercise");
            if (!fs.existsSync(exercisePath)) {
                fs.ensureDirSync(exercisePath);
                ncp(PASSING_EXERCISE_PATH, exercisePath, () => {});
            }
        });

        test.skip("should result in AuthorizationError if not authenticated", async function () {
            const result = await tmcUnauthenticated.downloadOldSubmission(
                1,
                exercisePath,
                404,
                false,
            );
            expect(result.val).to.be.instanceOf(AuthorizationError);
        });

        test("should download old submission", async function () {
            const result = await tmc.downloadOldSubmission(1, exercisePath, 0, false);
            expect(result.ok).to.be.true;
        });

        test("should not save old state when the flag is off", async function () {
            // This test is based on a side effect of making a new submission.
            const submissions = (await tmc.getOldSubmissions(1)).unwrap();
            await tmc.downloadOldSubmission(1, exercisePath, 0, false);
            const newSubmissions = (await tmc.getOldSubmissions(1)).unwrap();
            expect(newSubmissions.length).to.be.equal(submissions.length);
        });

        test("should save old state when the flag is on", async function () {
            // This test is based on a side effect of making a new submission.
            const submissions = (await tmc.getOldSubmissions(1)).unwrap();
            await tmc.downloadOldSubmission(1, exercisePath, 0, true);
            const newSubmissions = (await tmc.getOldSubmissions(1)).unwrap();
            expect(newSubmissions.length).to.be.equal(submissions.length + 1);
        });

        test("should cause RuntimeError for nonexistent exercise", async function () {
            const missingExercisePath = path.resolve(exercisePath, "..", "404");
            const result = await tmc.downloadOldSubmission(1, missingExercisePath, 0, false);
            expect(result.val).to.be.instanceOf(RuntimeError);
        });
    });

    suite("getCourseData()", function () {
        // Fails with TMC-langs 0.15.0 because data.output-data.kind is "generic"
        test.skip("should result in AuthorizationError if not authenticated", async function () {
            const result = await tmcUnauthenticated.getCourseData(0);
            expect(result.val).to.be.instanceOf(AuthorizationError);
        });

        test("should result in course data when authenticated", async function () {
            const data = (await tmc.getCourseData(0)).unwrap();
            expect(data.details.name).to.be.equal("python-course");
            expect(data.exercises.length).to.be.equal(2);
            expect(data.settings.name).to.be.equal("python-course");
        });

        test("should result in RuntimeError for nonexistent course", async function () {
            const result = await tmc.getCourseData(404);
            expect(result.val).to.be.instanceOf(RuntimeError);
        });
    });

    suite("getCourseDetails()", function () {
        test("should result in AuthorizationError if not authenticated", async function () {
            const result = await tmcUnauthenticated.getCourseDetails(0);
            expect(result.val).to.be.instanceOf(AuthorizationError);
        });

        test("should return course details of given course", async function () {
            const course = (await tmc.getCourseDetails(0)).unwrap().course;
            expect(course.id).to.be.equal(0);
            expect(course.name).to.be.equal("python-course");
        });

        test("should result in RuntimeError for nonexistent course", async function () {
            const result = await tmc.getCourseDetails(404);
            expect(result.val).to.be.instanceOf(RuntimeError);
        });
    });

    suite("getCourseExercises()", function () {
        test("should result in AuthorizationError if not authenticated", async function () {
            const result = await tmcUnauthenticated.getCourseExercises(0);
            expect(result.val).to.be.instanceOf(AuthorizationError);
        });

        test("should return course exercises of the given course", async function () {
            const exercises = (await tmc.getCourseExercises(0)).unwrap();
            expect(exercises.length).to.be.equal(2);
        });

        test("should result in RuntimeError with nonexistent course", async function () {
            const result = await tmc.getCourseExercises(404);
            expect(result.val).to.be.instanceOf(RuntimeError);
        });
    });

    suite("getCourses()", function () {
        test("should result in AuthorizationError if not authenticated", async function () {
            const result = await tmcUnauthenticated.getCourses("test");
            expect(result.val).to.be.instanceOf(AuthorizationError);
        });

        test("should return courses when authenticated", async function () {
            const course = (await tmc.getCourses("test")).unwrap();
            expect(course.length).to.be.equal(1);
            expect(course.some((x) => x.name === "python-course")).to.be.true;
        });

        test("should result in RuntimeError for nonexistent organization", async function () {
            const result = await tmc.getCourses("404");
            expect(result.val).to.be.instanceOf(RuntimeError);
        });
    });

    suite("getCourseSettings()", function () {
        test("should result in AuthorizationError if not authenticated", async function () {
            const result = await tmcUnauthenticated.getCourseSettings(0);
            expect(result.val).to.be.instanceOf(AuthorizationError);
        });

        test("should return course settings when authenticated", async function () {
            const course = (await tmc.getCourseSettings(0)).unwrap();
            expect(course.name).to.be.equal("python-course");
        });

        test("should result in RuntimeError with nonexistent course", async function () {
            const result = await tmc.getCourseSettings(404);
            expect(result.val).to.be.instanceOf(RuntimeError);
        });
    });

    suite("getExerciseDetails()", function () {
        test("should result in AuthorizationError if not authenticated", async function () {
            const result = await tmcUnauthenticated.getExerciseDetails(1);
            expect(result.val).to.be.instanceOf(AuthorizationError);
        });

        test("should return exercise details when authenticated", async function () {
            const exercise = (await tmc.getExerciseDetails(1)).unwrap();
            expect(exercise.exercise_name).to.be.equal("part01-01_passing_exercise");
        });

        test("should result in RuntimeError for nonexistent exercise", async function () {
            const result = await tmc.getExerciseDetails(404);
            expect(result.val).to.be.instanceOf(RuntimeError);
        });
    });

    suite("getOldSubmissions()", function () {
        test("should result in AuthorizationError if not authenticated", async function () {
            const result = await tmcUnauthenticated.getOldSubmissions(1);
            expect(result.val).to.be.instanceOf(AuthorizationError);
        });

        test("should return old submissions when authenticated", async function () {
            const submissions = (await tmc.getOldSubmissions(1)).unwrap();
            expect(submissions.length).to.be.greaterThan(0);
        });

        test("should result in RuntimeError for nonexistent exercise", async function () {
            const result = await tmc.getOldSubmissions(404);
            expect(result.val).to.be.instanceOf(RuntimeError);
        });
    });

    suite("getOrganizations()", function () {
        test("should return organizations", async function () {
            const result = await tmc.getOrganizations();
            expect(result.unwrap().length).to.be.equal(1, "Expected to get one organization.");
        });
    });

    suite("getOrganization()", function () {
        test("should return given organization", async function () {
            const organization = (await tmc.getOrganization("test")).unwrap();
            expect(organization.slug).to.be.equal("test");
            expect(organization.name).to.be.equal("Test Organization");
        });

        test("should result in RuntimeError for nonexistent organization", async function () {
            const result = await tmc.getOrganization("404");
            expect(result.val).to.be.instanceOf(RuntimeError);
        });
    });

    suite("resetExercise()", function () {
        this.timeout(5000);

        function setupExercise(folderName: string): string {
            const projectsDir = setupProjectsDir(folderName);
            const exercisePath = path.join(projectsDir, "part01-01_passing_exercise");
            if (!fs.existsSync(exercisePath)) {
                fs.ensureDirSync(exercisePath);
                ncp(PASSING_EXERCISE_PATH, exercisePath, () => {});
            }
            return exercisePath;
        }

        // This actually passes
        test.skip("should result in AuthorizationError if not authenticated", async function () {
            const exercisePath = setupExercise("resetExercise0");
            const result = await tmcUnauthenticated.resetExercise(1, exercisePath, false);
            expect(result.val).to.be.instanceOf(AuthorizationError);
        });

        // Windows CI can't handle this for some reason?
        test.skip("should reset exercise", async function () {
            const exercisePath = setupExercise("resetExercise1");
            const result = await tmc.resetExercise(1, exercisePath, false);
            if (result.err) {
                expect.fail(result.val.message + ": " + result.val.stack);
            }
        });

        test("should not save old state if the flag is off", async function () {
            // This test is based on a side effect of making a new submission.
            const exercisePath = setupExercise("resetExercise2");
            const submissions = (await tmc.getOldSubmissions(1)).unwrap();
            await tmc.resetExercise(1, exercisePath, false);
            const newSubmissions = (await tmc.getOldSubmissions(1)).unwrap();
            expect(newSubmissions.length).to.be.equal(submissions.length);
        });

        test("should save old state if the flag is on", async function () {
            // This test is based on a side effect of making a new submission.
            const exercisePath = setupExercise("resetExercise3");
            const submissions = (await tmc.getOldSubmissions(1)).unwrap();
            await tmc.resetExercise(1, exercisePath, true);
            const newSubmissions = (await tmc.getOldSubmissions(1)).unwrap();
            expect(newSubmissions.length).to.be.equal(submissions.length + 1);
        });
    });

    suite("submitExerciseAndWaitForResults()", function () {
        test("should result in AuthorizationError if not authenticated", async function () {
            const result = await tmcUnauthenticated.submitExerciseAndWaitForResults(
                1,
                PASSING_EXERCISE_PATH,
            );
            expect(result.val).to.be.instanceOf(AuthorizationError);
        });

        test("should make a submission and give results when authenticated", async function () {
            this.timeout(5000);
            const results = (
                await tmc.submitExerciseAndWaitForResults(1, PASSING_EXERCISE_PATH)
            ).unwrap();
            expect(results.status).to.be.equal("ok");
        });

        test("should return submission link during the submission process", async function () {
            this.timeout(5000);
            let url: string | undefined;
            await tmc.submitExerciseAndWaitForResults(
                1,
                PASSING_EXERCISE_PATH,
                undefined,
                (x) => (url = x),
            );
            expect(url).to.be.ok;
        });

        test("should result in BottleneckError if called twice too soon", async function () {
            this.timeout(5000);
            const first = tmc.submitExerciseAndWaitForResults(1, PASSING_EXERCISE_PATH);
            const second = tmc.submitExerciseAndWaitForResults(1, PASSING_EXERCISE_PATH);
            const [, secondResult] = await Promise.all([first, second]);
            expect(secondResult.val).to.be.instanceOf(BottleneckError);
        });

        test("should result in RuntimeError for nonexistent exercise", async function () {
            const result = await tmc.submitExerciseAndWaitForResults(1, MISSING_EXERCISE_PATH);
            expect(result.val).to.be.instanceOf(RuntimeError);
        });
    });

    suite("submitExerciseToPaste()", function () {
        // Current Langs doesn't actually check this
        test.skip("should result in AuthorizationError if not authenticated", async function () {
            const result = await tmcUnauthenticated.submitExerciseToPaste(1, PASSING_EXERCISE_PATH);
            expect(result.val).to.be.instanceOf(AuthorizationError);
        });

        test("should make a paste submission when authenticated", async function () {
            const pasteUrl = (await tmc.submitExerciseToPaste(1, PASSING_EXERCISE_PATH)).unwrap();
            expect(pasteUrl).to.include("localhost");
        });

        test("should result in BottleneckError if called twice too soon", async function () {
            this.timeout(5000);
            const first = tmc.submitExerciseAndWaitForResults(1, PASSING_EXERCISE_PATH);
            const second = tmc.submitExerciseAndWaitForResults(1, PASSING_EXERCISE_PATH);
            const [, secondResult] = await Promise.all([first, second]);
            expect(secondResult.val).to.be.instanceOf(BottleneckError);
        });

        test("should result in RuntimeError for nonexistent exercise", async function () {
            const result = await tmc.submitExerciseToPaste(404, MISSING_EXERCISE_PATH);
            expect(result.val).to.be.instanceOf(RuntimeError);
        });
    });

    suite("submitSubmissionFeedback()", function () {
        const feedback: SubmissionFeedback = {
            status: [{ question_id: 0, answer: "42" }],
        };

        test("should submit feedback when authenticated", async function () {
            const result = await tmc.submitSubmissionFeedback(FEEDBACK_URL, feedback);
            expect(result.ok).to.be.true;
        });
    });

    suiteTeardown(function () {
        server && kill(server.pid);
    });
});
