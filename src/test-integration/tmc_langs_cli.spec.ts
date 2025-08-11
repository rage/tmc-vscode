import { expect } from "chai";
import * as cp from "child_process";
import { deleteSync } from "del";
import * as fs from "fs-extra";
import { first } from "lodash";
import * as path from "path";
import * as kill from "tree-kill";
import { Result } from "ts-results";

import Langs from "../api/langs";
import { SubmissionFeedback } from "../api/types";
import { CLIENT_NAME, TMC_LANGS_VERSION } from "../config/constants";
import { AuthenticationError, AuthorizationError, BottleneckError, RuntimeError } from "../errors";
import { getLangsCLIForPlatform, getPlatform } from "../utilities/";
import { CourseIdentifier, ExerciseIdentifier } from "../shared/shared";

// __dirname is the dist folder when built.
const PROJECT_ROOT = path.join(__dirname, "..");
const ARTIFACT_FOLDER = path.join(PROJECT_ROOT, "test-artifacts");

// Use CLI from backend folder to run tests.
const BACKEND_FOLDER = path.join(PROJECT_ROOT, "backend");
const CLI_PATH = path.join(BACKEND_FOLDER, "cli");
const CLI_FILE = path.join(CLI_PATH, getLangsCLIForPlatform(getPlatform(), TMC_LANGS_VERSION));
const FEEDBACK_URL = "http://localhost:4001/feedback";

// Example backend credentials
const USERNAME = "TestMyExtension";
const PASSWORD = "hunter2";

// Config dir name must follow conventions mandated by TMC-langs.
const CLIENT_CONFIG_DIR_NAME = `tmc-${CLIENT_NAME}`;

suite("tmc langs cli spec", function () {
    let server: cp.ChildProcess | undefined;

    suiteSetup(async function () {
        this.timeout(30000);
        server = await startServer();
    });

    let testDir: string;

    setup(function () {
        let testDirName = this.currentTest?.fullTitle().replace(/\s/g, "_");
        if (!testDirName) {
            throw new Error("Illegal function call.");
        }
        if (testDirName?.length > 72) {
            testDirName =
                testDirName.substring(0, 40) +
                ".." +
                testDirName.substring(testDirName.length - 30);
        }
        testDir = path.join(ARTIFACT_FOLDER, testDirName);
    });

    suite("authenticated user", function () {
        let configDir: string;
        let onLoggedInCalls: number;
        let onLoggedOutCalls: number;
        let projectsDir: string;
        let tmc: Langs;

        setup(function () {
            configDir = path.join(testDir, CLIENT_CONFIG_DIR_NAME);
            writeCredentials(configDir);
            onLoggedInCalls = 0;
            onLoggedOutCalls = 0;
            projectsDir = setupProjectsDir(configDir, path.join(testDir, "tmcdata"));
            tmc = new Langs(CLI_FILE, CLIENT_NAME, "test", {
                cliConfigDir: testDir,
            });
            tmc.on("login", () => onLoggedInCalls++);
            tmc.on("logout", () => onLoggedOutCalls++);
        });

        test("should not be able to re-authenticate", async function () {
            const result = await tmc.authenticate(USERNAME, PASSWORD);
            expect(result.val).to.be.instanceOf(AuthenticationError);
        });

        test("should be able to deauthenticate", async function () {
            await unwrapResult(tmc.deauthenticate());
            expect(onLoggedOutCalls).to.be.equal(1);

            const result = await unwrapResult(tmc.isAuthenticated());
            expect(result).to.be.false;

            expect(onLoggedInCalls).to.be.equal(0);
        });

        test("should be able to read and change settings", async function () {
            const key = "test-value";
            const isString = (object: unknown): object is string => typeof object === "string";

            const result1 = await unwrapResult(tmc.getSetting(key, isString));
            expect(result1).to.be.undefined;

            await unwrapResult(tmc.setSetting(key, "yes no yes yes"));
            const result2 = await unwrapResult(tmc.getSetting(key, isString));
            expect(result2).to.be.equal("yes no yes yes");

            await unwrapResult(tmc.unsetSetting(key));
            const result3 = await unwrapResult(tmc.getSetting(key, isString));
            expect(result3).to.be.undefined;

            await unwrapResult(tmc.setSetting(key, "foo bar biz baz"));
            await unwrapResult(tmc.resetSettings());
            const result4 = await unwrapResult(tmc.getSetting(key, isString));
            expect(result4).to.be.undefined;
        });

        test("should be able to download an existing exercise", async function () {
            const result = await tmc.downloadExercises(
                [ExerciseIdentifier.from(1)],
                true,
                () => {},
            );
            result.err && expect.fail(`Expected operation to succeed: ${result.val.message}`);
        }).timeout(10000);

        // Ids missing from the server are missing from the response.
        test.skip("should not be able to download a non-existent exercise", async function () {
            const [tmcDownloads, moocDownloads] = (
                await tmc.downloadExercises([ExerciseIdentifier.from(404)], true, () => {})
            ).unwrap();
            expect(tmcDownloads.failed?.length).to.be.equal(1);
        });

        test("should get existing api data", async function () {
            const data = (await tmc.getTmcCourseData(1)).unwrap();
            expect(data.details.name).to.be.equal("python-course");
            expect(data.exercises.length).to.be.equal(2);
            expect(data.settings.name).to.be.equal("python-course");

            const details = (await tmc.getCourseDetails(CourseIdentifier.from(1))).unwrap();
            expect(details.id).to.be.equal(1);
            expect(details.name).to.be.equal("python-course");

            const exercises = (await tmc.getCourseExercises(1)).unwrap();
            expect(exercises.length).to.be.equal(2);

            const settings = (await tmc.getCourseSettings(1)).unwrap();
            expect(settings.name).to.be.equal("python-course");

            const courses = (await tmc.getCourses("test")).unwrap();
            expect(courses.length).to.be.equal(2);
            expect(courses.some((x) => x.name === "python-course")).to.be.true;

            const exercise = (await tmc.getExerciseDetails(1)).unwrap();
            expect(exercise.exercise_name).to.be.equal("part01-01_passing_exercise");

            const submissions = (await tmc.getTmcOldSubmissions(1)).unwrap();
            expect(submissions.length).to.be.greaterThan(0);

            const organization = (await tmc.getOrganization("test")).unwrap();
            expect(organization.slug).to.be.equal("test");
            expect(organization.name).to.be.equal("Test Organization");

            const organizations = (await tmc.getTmcOrganizations()).unwrap();
            expect(organizations.length).to.be.equal(1, "Expected to get one organization.");
        });

        test("should encounter errors when trying to get non-existing api data", async function () {
            const dataResult = await tmc.getTmcCourseData(404);
            expect(dataResult.val).to.be.instanceOf(RuntimeError);

            const detailsResult = await tmc.getCourseDetails(CourseIdentifier.from(404));
            expect(detailsResult.val).to.be.instanceOf(RuntimeError);

            const exercisesResult = await tmc.getCourseExercises(404);
            expect(exercisesResult.val).to.be.instanceOf(RuntimeError);

            const settingsResult = await tmc.getCourseSettings(404);
            expect(settingsResult.val).to.be.instanceOf(RuntimeError);

            const coursesResult = await tmc.getCourses("404");
            expect(coursesResult.val).to.be.instanceOf(RuntimeError);

            const exerciseResult = await tmc.getExerciseDetails(404);
            expect(exerciseResult.val).to.be.instanceOf(RuntimeError);

            const submissionsResult = await tmc.getTmcOldSubmissions(404);
            expect(submissionsResult.val).to.be.instanceOf(RuntimeError);

            const result = await tmc.getOrganization("404");
            expect(result.val).to.be.instanceOf(RuntimeError);
        });

        test("should be able to give feedback", async function () {
            const feedback: SubmissionFeedback = {
                status: [{ question_id: 0, answer: "42" }],
            };
            await unwrapResult(tmc.submitSubmissionFeedback(FEEDBACK_URL, feedback));
        });

        suite("with a local exercise", function () {
            this.timeout(20000);

            let exercisePath: string;

            setup(async function () {
                deleteSync(projectsDir, { force: true });
                const [tmcRes, moocRes] = (
                    await tmc.downloadExercises([ExerciseIdentifier.from(1)], true, () => {})
                ).unwrap();
                exercisePath = tmcRes.downloaded[0].path;
            });

            test("should be able to clean the exercise", async function () {
                await unwrapResult(tmc.clean(exercisePath));
            });

            test("should be able to list local exercises", async function () {
                const result = await unwrapResult(
                    tmc.listLocalCourseExercises("tmc", "python-course"),
                );
                expect(result.length).to.be.equal(1);
                expect(first(result)?.["exercise-path"]).to.be.equal(exercisePath);
            });

            test("should be able to run tests for exercise", async function () {
                const result = await unwrapResult(tmc.runTests(exercisePath)[0]);
                expect(result.status).to.be.equal("PASSED");
            });

            test("should be able to migrate the exercise to langs projects directory", async function () {
                // By changing projects directory path, the exercise is no longer there. Therefore
                // it can be "migrated".
                projectsDir = setupProjectsDir(configDir, path.join(testDir, "tmcdata2"));
                fs.emptyDirSync(projectsDir);
                await unwrapResult(
                    tmc.migrateExercise("python-course", "abc123", 1, exercisePath, "hello-world"),
                );
            });

            test("should be able to move projects directory", async function () {
                const newProjectsDir = path.resolve(projectsDir, "..", "tmcdata2");
                fs.emptyDirSync(newProjectsDir);
                await unwrapResult(tmc.moveProjectsDirectory(newProjectsDir));
            });

            test("should be able to check for exercise updates", async function () {
                const result = await unwrapResult(tmc.checkTmcExerciseUpdates());
                expect(result.length).to.be.equal(0);
            });

            test("should be able to save the exercise state and revert it to an old submission", async function () {
                const submissions = await unwrapResult(tmc.getTmcOldSubmissions(1));
                await unwrapResult(tmc.downloadTmcOldSubmission(1, exercisePath, 1, true));

                // State saving check is based on a side effect of making a new submission.
                const newSubmissions = await unwrapResult(tmc.getTmcOldSubmissions(1));
                expect(newSubmissions.length).to.be.equal(submissions.length + 1);
            });

            test("should be able to download an old submission without saving the current state", async function () {
                const submissions = await unwrapResult(tmc.getTmcOldSubmissions(1));
                await unwrapResult(tmc.downloadTmcOldSubmission(1, exercisePath, 1, false));

                // State saving check is based on a side effect of making a new submission.
                const newSubmissions = await unwrapResult(tmc.getTmcOldSubmissions(1));
                expect(newSubmissions.length).to.be.equal(submissions.length);
            });

            // Langs fails to remove folder on Windows CI
            test.skip("should be able to save the exercise state and reset it to original template", async function () {
                const submissions = await unwrapResult(tmc.getTmcOldSubmissions(1));
                await unwrapResult(
                    tmc.resetExercise(ExerciseIdentifier.from(1), exercisePath, true),
                );

                // State saving check is based on a side effect of making a new submission.
                const newSubmissions = await unwrapResult(tmc.getTmcOldSubmissions(1));
                expect(newSubmissions.length).to.be.equal(submissions.length + 1);
            });

            // Langs fails to remove folder on Windows CI
            test.skip("should be able to reset exercise without saving the current state", async function () {
                const submissions = await unwrapResult(tmc.getTmcOldSubmissions(1));
                await unwrapResult(
                    tmc.resetExercise(ExerciseIdentifier.from(1), exercisePath, false),
                );

                // State saving check is based on a side effect of making a new submission.
                const newSubmissions = await unwrapResult(tmc.getTmcOldSubmissions(1));
                expect(newSubmissions.length).to.be.equal(submissions.length);
            });

            test("should be able to submit the exercise for evaluation", async function () {
                let url: string | undefined;
                const results = await unwrapResult(
                    tmc.submitExerciseAndWaitForResults(
                        ExerciseIdentifier.from(1),
                        exercisePath,
                        undefined,
                        (x) => (url = x),
                    ),
                );
                expect(results.status).to.be.equal("ok");
                !url && expect.fail("expected to receive submission url during submission.");
            });

            test("should encounter an error if trying to submit the exercise twice too soon", async function () {
                const first = tmc.submitExerciseAndWaitForResults(
                    ExerciseIdentifier.from(1),
                    exercisePath,
                );
                const second = tmc.submitExerciseAndWaitForResults(
                    ExerciseIdentifier.from(1),
                    exercisePath,
                );
                const [, secondResult] = await Promise.all([first, second]);
                expect(secondResult.val).to.be.instanceOf(BottleneckError);
            });

            test("should be able to submit the exercise to TMC-paste", async function () {
                const pasteUrl = await unwrapResult(tmc.submitTmcExerciseToPaste(1, exercisePath));
                expect(pasteUrl).to.include("localhost");
            });

            test("should encounter an error if trying to submit to paste twice too soon", async function () {
                const first = tmc.submitTmcExerciseToPaste(1, exercisePath);
                const second = tmc.submitTmcExerciseToPaste(1, exercisePath);
                const [, secondResult] = await Promise.all([first, second]);
                expect(secondResult.val).to.be.instanceOf(BottleneckError);
            });
        });

        suite("with a missing local exercise", function () {
            let missingExercisePath: string;

            setup(async function () {
                missingExercisePath = path.join(projectsDir, "missing-course", "missing-exercise");
            });

            test("should encounter an error when attempting to clean it", async function () {
                const result = await tmc.clean(missingExercisePath);
                expect(result.val).to.be.instanceOf(RuntimeError);
            });

            test("should encounter an error when attempting to run tests for it", async function () {
                const result = await tmc.runTests(missingExercisePath)[0];
                expect(result.val).to.be.instanceOf(RuntimeError);
            });

            // Downloads exercise on Langs 0.18
            test.skip("should encounter an error when attempting to revert to an older submission", async function () {
                const result = await tmc.downloadTmcOldSubmission(1, missingExercisePath, 1, false);
                expect(result.val).to.be.instanceOf(RuntimeError);
            });

            test("should encounter an error when trying to reset it", async function () {
                const result = await tmc.resetExercise(
                    ExerciseIdentifier.from(1),
                    missingExercisePath,
                    false,
                );
                expect(result.val).to.be.instanceOf(RuntimeError);
            });

            test("should encounter an error when trying to submit it", async function () {
                const result = await tmc.submitExerciseAndWaitForResults(
                    ExerciseIdentifier.from(1),
                    missingExercisePath,
                );
                expect(result.val).to.be.instanceOf(RuntimeError);
            });

            test("should encounter an error when trying to submit it to TMC-paste", async function () {
                const result = await tmc.submitTmcExerciseToPaste(404, missingExercisePath);
                expect(result.val).to.be.instanceOf(RuntimeError);
            });
        });
    });

    suite("unauthenticated user", function () {
        let onLoggedInCalls: number;
        let onLoggedOutCalls: number;
        let configDir: string;
        let projectsDir: string;
        let tmc: Langs;

        setup(function () {
            configDir = path.join(testDir, CLIENT_CONFIG_DIR_NAME);
            clearCredentials(configDir);
            onLoggedInCalls = 0;
            onLoggedOutCalls = 0;
            projectsDir = setupProjectsDir(configDir, path.join(testDir, "tmcdata"));
            tmc = new Langs(CLI_FILE, CLIENT_NAME, "test", {
                cliConfigDir: testDir,
            });
            tmc.on("login", () => onLoggedInCalls++);
            tmc.on("logout", () => onLoggedOutCalls++);
        });

        // TODO: There was something fishy with this test
        test("should not be able to authenticate with empty credentials", async function () {
            const result = await tmc.authenticate("", "");
            expect(result.val).to.be.instanceOf(AuthenticationError);
        });

        test("should not be able to authenticate with incorrect credentials", async function () {
            const result = await tmc.authenticate(USERNAME, "batman123");
            expect(result.val).to.be.instanceOf(AuthenticationError);
        });

        test("should be able to authenticate with correct credentials", async function () {
            await unwrapResult(tmc.authenticate(USERNAME, PASSWORD));
            expect(onLoggedInCalls).to.be.equal(1);

            const result2 = await unwrapResult(tmc.isAuthenticated());
            expect(result2).to.be.true;

            expect(onLoggedOutCalls).to.be.equal(0);
        });

        test("should not be able to download an exercise", async function () {
            const result = await tmc.downloadExercises(
                [ExerciseIdentifier.from(1)],
                true,
                () => {},
            );
            expect(result.val).to.be.instanceOf(RuntimeError);
        });

        test("should not get existing api data in general", async function () {
            const dataResult = await tmc.getTmcCourseData(0);
            expect(dataResult.val).to.be.instanceOf(RuntimeError);

            const detailsResult = await tmc.getCourseDetails(CourseIdentifier.from(0));
            expect(detailsResult.val).to.be.instanceOf(AuthorizationError);

            const exercisesResult = await tmc.getCourseExercises(0);
            expect(exercisesResult.val).to.be.instanceOf(AuthorizationError);

            const settingsResult = await tmc.getCourseSettings(0);
            expect(settingsResult.val).to.be.instanceOf(AuthorizationError);

            const coursesResult = await tmc.getCourses("test");
            expect(coursesResult.val).to.be.instanceOf(AuthorizationError);

            const exerciseResult = await tmc.getExerciseDetails(1);
            expect(exerciseResult.val).to.be.instanceOf(AuthorizationError);

            const submissionsResult = await tmc.getTmcOldSubmissions(1);
            expect(submissionsResult.val).to.be.instanceOf(AuthorizationError);
        });

        test("should be able to get valid organization data", async function () {
            const organization = await unwrapResult(tmc.getOrganization("test"));
            expect(organization.slug).to.be.equal("test");
            expect(organization.name).to.be.equal("Test Organization");

            const organizations = await unwrapResult(tmc.getTmcOrganizations());
            expect(organizations.length).to.be.equal(1, "Expected to get one organization.");
        });

        test("should encounter error if trying to get non-existing organization data", async function () {
            const result = await tmc.getOrganization("404");
            expect(result.val).to.be.instanceOf(RuntimeError);
        });

        // This seems to ok?
        test("should not be able to give feedback", async function () {
            const feedback: SubmissionFeedback = {
                status: [{ question_id: 0, answer: "42" }],
            };
            const result = await tmc.submitSubmissionFeedback(FEEDBACK_URL, feedback);
            expect(result.val).to.be.instanceOf(AuthorizationError);
        });

        suite("with a local exercise", function () {
            this.timeout(20000);

            let exercisePath: string;

            setup(async function () {
                deleteSync(projectsDir, { force: true });
                writeCredentials(configDir);
                const [tmcRes, moocRes] = (
                    await tmc.downloadExercises([ExerciseIdentifier.from(1)], true, () => {})
                ).unwrap();
                clearCredentials(configDir);
                exercisePath = tmcRes.downloaded[0].path;
            });

            test("should be able to clean the exercise", async function () {
                const result = await unwrapResult(tmc.clean(exercisePath));
                expect(result).to.be.undefined;
            });

            test("should be able to list local exercises", async function () {
                const result = await unwrapResult(
                    tmc.listLocalCourseExercises("tmc", "python-course"),
                );
                expect(result.length).to.be.equal(1);
                expect(first(result)?.["exercise-path"]).to.be.equal(exercisePath);
            });

            test("should be able to run tests for exercise", async function () {
                const result = await unwrapResult(tmc.runTests(exercisePath)[0]);
                expect(result.status).to.be.equal("PASSED");
            });

            test("should not be able to load old submission", async function () {
                const result = await tmc.downloadTmcOldSubmission(1, exercisePath, 1, true);
                expect(result.val).to.be.instanceOf(RuntimeError);
            });

            test("should not be able to reset exercise", async function () {
                const result = await tmc.resetExercise(
                    ExerciseIdentifier.from(1),
                    exercisePath,
                    true,
                );
                expect(result.val).to.be.instanceOf(AuthorizationError);
            });

            test("should not be able to submit exercise", async function () {
                const result = await tmc.submitExerciseAndWaitForResults(
                    ExerciseIdentifier.from(1),
                    exercisePath,
                );
                expect(result.val).to.be.instanceOf(AuthorizationError);
            });

            // This actually works
            test.skip("should not be able to submit exercise to TMC-paste", async function () {
                const result = await tmc.submitTmcExerciseToPaste(1, exercisePath);
                expect(result.val).to.be.instanceOf(AuthorizationError);
            });
        });
    });

    suiteTeardown(function () {
        server && kill(server.pid as number);
        // the command above didn't seem to work reliably, so the call below was added
        server?.kill();
    });
});

function writeCredentials(configDir: string): void {
    if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
    }
    fs.writeFileSync(
        path.join(configDir, "credentials.json"),
        '{"access_token":"1234","token_type":"bearer","scope":"public"}',
    );
}

function clearCredentials(configDir: string): void {
    deleteSync(path.join(configDir, "credentials.json"), { force: true });
}

function setupProjectsDir(configDir: string, projectsDir: string): string {
    if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
    }
    fs.writeFileSync(path.join(configDir, "config.toml"), `projects-dir = '${projectsDir}'\n`);
    return projectsDir;
}

async function unwrapResult<T>(result: Promise<Result<T, Error>>): Promise<T> {
    const res = await result;
    if (res.err) {
        expect.fail(`TMC-langs execution failed: ${res.val.message}`);
    }
    return res.val;
}

async function startServer(): Promise<cp.ChildProcess> {
    let ready = false;
    const backendPath = path.join(__dirname, "..", "backend");
    console.log("Running npm start at", backendPath);
    const server = cp.spawn("npm", ["start"], {
        cwd: backendPath,
        shell: "bash",
    });
    console.info("[server] starting...");
    server.stdout.on("data", (chunk) => {
        console.info(`[server] ${chunk.toString()}`);
        if (chunk.toString().startsWith("Server listening to")) {
            ready = true;
        }
    });

    const timeout = setTimeout(() => {
        throw new Error("Failed to start server");
    }, 20000);

    while (!ready) {
        await new Promise((resolve) => setTimeout(resolve, 1000, []));
    }

    clearTimeout(timeout);
    return server;
}
