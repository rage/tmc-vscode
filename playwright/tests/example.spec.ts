import { vsCodeTest } from "../fixtures";

vsCodeTest("get started link", async ({ page }) => {
    await page.getByRole("tab", { name: "TestMyCode" }).locator("a").click();
    await page.getByRole("heading", { name: "TestMyCode: Menu" }).waitFor();
    await page.getByText("Log in").click();
});
