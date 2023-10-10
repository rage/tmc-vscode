import { expect } from "@playwright/test";

import { vsCodeTest } from "../fixtures";
import { CoursePage } from "../pages/course";
import { ExplorerPage } from "../pages/explorer";
import { LoginPage } from "../pages/login";
import { MyCoursesPage } from "../pages/my-courses";
import { TestResultsPage } from "../pages/test-results";
import { TestSubmissionPage } from "../pages/test-submission";

type Exercise = {
    course: string;
    name: string;
    file_path: Array<string>;
    file_contents: string;
    expected_result: "PASSED" | "FAILED";
};

const exercises: Array<Exercise> = [
    {
        course: "Python Course",
        name: "01_passing_exercise",
        file_path: ["src", "passing_exercise.py"],
        file_contents: "def hello()",
        expected_result: "PASSED",
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
            const openedStatus = webview.getByText("opened");
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
            await page.getByText(exercise.file_contents).click();
            const successMessage = testResultsPage
                .getWebview()
                .getByRole("heading", { name: exercise.expected_result });
            await expect(successMessage).not.toBeVisible();
            // wait for the extension to recognise that we have opened an exercise
            await page.waitForTimeout(500);
            await page.getByLabel("Run Tests (Ctrl+Shift+T)").click();
            await expect(successMessage).toBeVisible();
        });

        await vsCodeTest.step("submit exercise", async () => {
            await expect(
                testSubmissionPage
                    .getWebview()
                    .getByRole("heading", { name: exercise.expected_result }),
            ).not.toBeVisible();
            await testResultsPage.submit();
            await expect(
                testSubmissionPage
                    .getWebview()
                    .getByRole("heading", { name: exercise.expected_result }),
            ).toBeVisible();
        });
    });
}
