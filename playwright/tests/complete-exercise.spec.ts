import { vsCodeTest } from "../fixtures";
import { CoursePage } from "../pages/course";
import { ExplorerPage } from "../pages/explorer";
import { LoginPage } from "../pages/login";
import { MyCoursesPage } from "../pages/my-courses";
import { TestResultsPage } from "../pages/test-results";
import { TestSubmissionPage } from "../pages/test-submission";
import { expect } from "@playwright/test";

type Exercise = {
    course: string;
    name: string;
    file_path: Array<string>;
    file_contents: string;
    expected_result: "pass" | "fail";
};

const exercises: Array<Exercise> = [
    {
        course: "Python Course",
        name: "01_passing_exercise",
        file_path: ["src", "passing_exercise.py"],
        file_contents: "def hello()",
        expected_result: "pass",
    },
];

for (const exercise of exercises) {
    vsCodeTest("can complete exercise", async ({ page, webview }) => {
        const loginPage = new LoginPage(page, webview);
        const myCoursesPage = new MyCoursesPage(page, webview);
        const coursePage = new CoursePage(page, webview);
        const testResultsPage = new TestResultsPage(page, webview);
        const testSubmissionPage = new TestSubmissionPage(page, webview);
        const explorerPage = new ExplorerPage(page);

        await vsCodeTest.step("log in", async () => {
            await loginPage.goto();
            await loginPage.login("student");
        });

        await vsCodeTest.step("open course", async () => {
            await myCoursesPage.addNewCourse(exercise.course);
            await myCoursesPage.selectCourse(exercise.course);
        });

        await vsCodeTest.step("open exercise", async () => {
            const openedStatus = webview.getByRole("cell", { name: "opened" });
            await expect(openedStatus).not.toBeVisible();
            await coursePage.showExercises();
            await coursePage.openExercises([exercise.name]);
            await expect(openedStatus).toBeVisible();
        });

        await vsCodeTest.step("open workspace", async () => {
            await coursePage.openWorkspace();
        });

        await vsCodeTest.step("open exercise file", async () => {
            const contents = page.getByText(exercise.file_contents);
            await expect(contents).not.toBeVisible();
            await explorerPage.openPath(exercise.file_path);
            await expect(contents).toBeVisible();
        });

        await vsCodeTest.step("run tests", async () => {
            const expectedString = expectedResultInTestView(exercise.expected_result);
            await page.getByText(exercise.file_contents).click();
            const successMessage = testResultsPage
                .getWebview()
                .getByRole("heading", { name: expectedString });
            await expect(successMessage).not.toBeVisible();
            // wait for the extension to recognise that we have opened an exercise
            await page.waitForTimeout(500);
            await page.getByLabel("Run Tests (Ctrl+Shift+T)").click();
            await expect(successMessage).toBeVisible();
        });

        await vsCodeTest.step("submit exercise", async () => {
            const expectedString = expectedResultInSubmissionView(exercise.expected_result);
            await expect(
                testSubmissionPage.getWebview().getByRole("heading", { name: expectedString }),
            ).not.toBeVisible();
            await testResultsPage.submit();
            await expect(
                testSubmissionPage.getWebview().getByRole("heading", { name: expectedString }),
            ).toBeVisible();
        });
    });
}

function expectedResultInTestView(expectedResult: "pass" | "fail"): string {
    if (expectedResult === "pass") {
        return "Tests passed";
    } else {
        return "Tests failed";
    }
}

function expectedResultInSubmissionView(expectedResult: "pass" | "fail"): string {
    if (expectedResult === "pass") {
        return "All tests passed on the server";
    } else {
        return "Some tests failed on the server";
    }
}
