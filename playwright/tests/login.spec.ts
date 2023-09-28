import { expect } from "@playwright/test";

import { vsCodeTest } from "../fixtures";
import { LoginPage } from "../pages/login";

vsCodeTest("can interact with the login page", async ({ page, webview }) => {
    const loginPage = new LoginPage(page, webview);

    await vsCodeTest.step("navigate to login page", async () => {
        await loginPage.goto();
        const loginPageHeader = webview.getByText("Login to TMC");
        await expect(loginPageHeader).toBeVisible();
    });

    await vsCodeTest.step("error with incorrect credentials", async () => {
        await loginPage.login("nonexistent");
        const error = webview.getByText("OAuth2 password exchange error");
        await expect(error).toBeVisible();
    });

    await vsCodeTest.step("can log in with correct credentials", async () => {
        await loginPage.login("student");
        const myCoursesHeader = loginPage.webview.getByRole("heading", { name: "My Courses" });
        await expect(myCoursesHeader).toBeVisible();
    });
});
