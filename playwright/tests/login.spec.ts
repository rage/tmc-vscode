import { vsCodeTest } from "../fixtures";
import { LoginPage } from "../pages/login";
import { expect } from "@playwright/test";

vsCodeTest("can interact with the login page", async ({ page, webview }) => {
    const loginPage = new LoginPage(page, webview);

    await vsCodeTest.step("navigate to login page", async () => {
        await loginPage.goto();
        const loginPageHeader = webview.getByRole("heading", { name: "Log in" });
        await expect(loginPageHeader).toBeVisible();
    });

    await vsCodeTest.step("error with incorrect credentials", async () => {
        await loginPage.login("nonexistent", "wrongpassword");
        const error = webview.getByText("OAuth2 password exchange error");
        await expect(error).toBeVisible();
    });

    await vsCodeTest.step("can log in with correct credentials", async () => {
        await loginPage.login("student");
        const myCoursesHeader = loginPage.webview.getByRole("heading", { name: "My Courses" });
        await expect(myCoursesHeader).toBeVisible();
    });
});
