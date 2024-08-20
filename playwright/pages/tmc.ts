import { FrameLocator, Page } from "@playwright/test";

export class TmcPage {
    constructor(
        public readonly page: Page,
        public readonly webview: FrameLocator,
    ) {}

    async openMenu(): Promise<void> {
        const isTmcOpen = await this.page
            .getByRole("heading", { name: "TestMyCode: Menu" })
            .isVisible();
        if (!isTmcOpen) {
            // wait for button to load properly
            await this.page.waitForTimeout(200);
            // the locator is very specific to not conflict with the "Welcome to TestMyCode" tab
            // for some reason, clicking it twice works...
            await this.page
                .locator('[id="workbench\\.parts\\.activitybar"]')
                .getByRole("tab", { name: "TestMyCode" })
                .locator("a")
                .click();
            await this.page
                .locator('[id="workbench\\.parts\\.activitybar"]')
                .getByRole("tab", { name: "TestMyCode" })
                .locator("a")
                .click();
        }
        await this.page.getByRole("heading", { name: "TestMyCode: Menu" }).waitFor();
    }

    getSidePanel(): FrameLocator {
        return this.page.frameLocator(`.webview.ready`).last().frameLocator("iframe#active-frame");
    }
}
