import { expect } from "chai";
import { sync as delSync } from "del";
import * as fs from "fs-extra";
import * as path from "path";
import * as TypeMoq from "typemoq";

import TMC from "../../api/tmc";
import { CLIENT_NAME } from "../../config/constants";
import Resources from "../../config/resources";
import { AuthenticationError, AuthorizationError, RuntimeError } from "../../errors";
import { getPlatform, getRustExecutable } from "../../utils/env";

suite("TMC", function () {
    // Use CLI from backend folder to run tests. The location is relative to the dist-folder
    // where webpack builds the test bundle.
    const CLI_PATH = path.join(__dirname, "..", "backend", "cli");
    const CLI_FILE = path.join(CLI_PATH, getRustExecutable(getPlatform()));
    const COURSE_PATH = path.join(__dirname, "..", "backend", "resources", "test-python-course");

    function removeCliConfig(): void {
        const config = path.join(CLI_PATH, `tmc-${CLIENT_NAME}`);
        delSync(config, { force: true });
    }

    function writeCliConfig(): void {
        const configPath = path.join(CLI_PATH, `tmc-${CLIENT_NAME}`);
        if (!fs.existsSync(configPath)) {
            fs.mkdirSync(configPath, { recursive: true });
        }

        fs.writeFileSync(
            path.join(configPath, "credentials.json"),
            '{"access_token":"1234","token_type":"bearer","scope":"public"}',
        );
    }

    let tmc: TMC;

    setup(function () {
        removeCliConfig();
        const resources = TypeMoq.Mock.ofType<Resources>();
        resources.setup((x) => x.getCliPath()).returns(() => CLI_FILE);
        resources.setup((x) => x.extensionVersion).returns(() => "test");
        tmc = new TMC(resources.object);
    });

    suite("#authenticate()", function () {
        test.skip("Causes AuthenticationError with empty credentials", async function () {
            const result = await tmc.authenticate("", "");
            expect(result.val).to.be.instanceOf(AuthenticationError);
        });

        test("Causes AuthenticationError with incorrect credentials", async function () {
            const result = await tmc.authenticate("TestMyCode", "hunter2");
            expect(result.val).to.be.instanceOf(AuthenticationError);
        });

        test("Succeeds with correct credentials", async function () {
            const result = await tmc.authenticate("TestMyExtension", "hunter2");
            expect(result.ok).to.be.true;
        });

        test("Causes AuthenticationError when already authenticated", async function () {
            writeCliConfig();
            const result = await tmc.authenticate("TestMyExtension", "hunter2");
            expect(result.val).to.be.instanceOf(AuthenticationError);
        });
    });

    suite("#isAuthenticated()", function () {
        test("Returns false when user config is missing", async function () {
            const result = await tmc.isAuthenticated();
            expect(result.val).to.be.false;
        });

        test("Returns true when user config exists", async function () {
            writeCliConfig();
            const result = await tmc.isAuthenticated();
            expect(result.val).to.be.true;
        });
    });

    suite("#setAuthenticationToken()", function () {
        test("Sets valid authentication token", async function () {
            const result = await tmc.setAuthenticationToken({ access_token: "1234" });
            expect(result.ok).to.be.true;
        });
    });

    suite("#deauthenticate()", function () {
        test("Deauthenticates", async function () {
            const result = await tmc.deauthenticate();
            expect(result.ok).to.be.true;
        });
    });

    suite("#clean()", function () {
        test("Clears exercise", async function () {
            const exercise = path.join(COURSE_PATH, "part01-01_passing_exercise");
            const result = (await tmc.clean(exercise)).unwrap();
            expect(result).to.be.undefined;
        });

        test("Causes RuntimeError for nonexistent exercise", async function () {
            const exercise = path.join(COURSE_PATH, "part01-404_missing_exercise");
            const result = await tmc.clean(exercise);
            expect(result.val).to.be.instanceOf(RuntimeError);
        });
    });

    suite("#runTests()", function () {
        test("Returns test results", async function () {
            const exercise = path.join(COURSE_PATH, "part01-01_passing_exercise");
            const result = (await tmc.runTests(exercise)[0]).unwrap();
            expect(result.status).to.be.equal("PASSED");
        }).timeout(20000);

        test("Can be interrupted");

        test("Causes RuntimeError for nonexistent exercise", async function () {
            const exercise = path.join(COURSE_PATH, "part01-404_missing_exercise");
            const result = await tmc.runTests(exercise)[0];
            expect(result.val).to.be.instanceOf(RuntimeError);
        });
    });

    suite("#getCourseData()", function () {
        test("Causes AuthorizationError if not authenticated", async function () {
            const result = await tmc.getCourseData(0);
            expect(result.val).to.be.instanceOf(AuthorizationError);
        });

        test("Returns course data when authenticated", async function () {
            writeCliConfig();
            const data = (await tmc.getCourseData(0)).unwrap();
            expect(data.details.name).to.be.equal("python-course");
            expect(data.exercises.length).to.be.equal(2);
            expect(data.settings.name).to.be.equal("python-course");
        });

        test("Causes RuntimeError for nonexistent course", async function () {
            writeCliConfig();
            const result = await tmc.getCourseData(404);
            expect(result.val).to.be.instanceOf(RuntimeError);
        });
    });

    suite("#getCourseDetails()", function () {
        test("Causes AuthorizationError if not authenticated", async function () {
            const result = await tmc.getCourseDetails(0);
            expect(result.val).to.be.instanceOf(AuthorizationError);
        });

        test("Returns course details of given course", async function () {
            writeCliConfig();
            const course = (await tmc.getCourseDetails(0)).unwrap().course;
            expect(course.id).to.be.equal(0);
            expect(course.name).to.be.equal("python-course");
        });

        test("Causes RuntimeError for nonexistent course", async function () {
            writeCliConfig();
            const result = await tmc.getCourseDetails(404);
            expect(result.val).to.be.instanceOf(RuntimeError);
        });
    });

    suite("#getCourseExercises()", function () {
        test("Causes AuthorizationError if not authenticated", async function () {
            const result = await tmc.getCourseExercises(0);
            expect(result.val).to.be.instanceOf(AuthorizationError);
        });

        test("Returns course exercises of the given course", async function () {
            writeCliConfig();
            const exercises = (await tmc.getCourseExercises(0)).unwrap();
            expect(exercises.length).to.be.equal(2);
        });

        test("Causes RuntimeError for nonexistent course", async function () {
            writeCliConfig();
            const result = await tmc.getCourseExercises(404);
            expect(result.val).to.be.instanceOf(RuntimeError);
        });
    });

    suite("#getCourses()", function () {
        test("Causes AuthorizationError if not authenticated", async function () {
            const result = await tmc.getCourses("test");
            expect(result.val).to.be.instanceOf(AuthorizationError);
        });

        test("Returns courses when authenticated", async function () {
            writeCliConfig();
            const course = (await tmc.getCourses("test")).unwrap();
            expect(course.length).to.be.equal(1);
            expect(course.some((x) => x.name === "python-course")).to.be.true;
        });

        test("Causes RuntimeError for nonexistent organization", async function () {
            writeCliConfig();
            const result = await tmc.getCourses("404");
            expect(result.val).to.be.instanceOf(RuntimeError);
        });
    });

    suite("#getCourseSettings()", function () {
        test("Causes AuthorizationError if not authenticated", async function () {
            const result = await tmc.getCourseSettings(0);
            expect(result.val).to.be.instanceOf(AuthorizationError);
        });

        test("Returns course settings when authenticated", async function () {
            writeCliConfig();
            const course = (await tmc.getCourseSettings(0)).unwrap();
            expect(course.name).to.be.equal("python-course");
        });

        test("Causes RuntimeError for nonexistent course", async function () {
            writeCliConfig();
            const result = await tmc.getCourseSettings(404);
            expect(result.val).to.be.instanceOf(RuntimeError);
        });
    });

    suite("#getExerciseDetails()", function () {
        test("Causes AuthorizationError if not authenticated", async function () {
            const result = await tmc.getExerciseDetails(1);
            expect(result.val).to.be.instanceOf(AuthorizationError);
        });

        test("Returns exercise details when authenticated", async function () {
            writeCliConfig();
            const exercise = (await tmc.getExerciseDetails(1)).unwrap();
            expect(exercise.exercise_name).to.be.equal("part01-01_passing_exercise");
        });

        test("Causes RuntimeError for nonexistent exercise", async function () {
            writeCliConfig();
            const result = await tmc.getExerciseDetails(404);
            expect(result.val).to.be.instanceOf(RuntimeError);
        });
    });

    suite("#getOrganizations()", function () {
        test("Returns organizations", async function () {
            const result = await tmc.getOrganizations();
            expect(result.unwrap().length).to.be.equal(1, "Expected to get one organization.");
        });
    });

    suite("#getOrganization()", function () {
        test("Returns given organization", async function () {
            const organization = (await tmc.getOrganization("test")).unwrap();
            expect(organization.slug).to.be.equal("test");
            expect(organization.name).to.be.equal("Test Organization");
        });

        test("Returns RuntimeError for nonexistent organization", async function () {
            const result = await tmc.getOrganization("404");
            expect(result.val).to.be.instanceOf(RuntimeError);
        });
    });

    suiteTeardown(removeCliConfig);
});
