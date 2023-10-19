import { expect } from "@playwright/test";

import { vsCodeTest } from "../fixtures";
import { LoginPage } from "../pages/login";
import { MyCoursesPage } from "../pages/my-courses";

vsCodeTest("can add new course", async ({ page, webview }) => {
    const loginPage = new LoginPage(page, webview);
    const myCoursesPage = new MyCoursesPage(page, webview);

    await vsCodeTest.step("log in", async () => {
        await loginPage.goto();
        await loginPage.login("student");
    });

    await vsCodeTest.step("add new course", async () => {
        const newCourseHeader = await webview.getByRole("heading", {
            name: "Python Course python-course",
        });
        await expect(newCourseHeader).not.toBeVisible();
        await myCoursesPage.addNewCourse("Python Course");
        await expect(newCourseHeader).toBeVisible();
    });
});
