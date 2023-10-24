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
            await this.page.getByRole("tab", { name: "TestMyCode" }).locator("a").click();
        }
        await this.page.getByRole("heading", { name: "TestMyCode: Menu" }).waitFor();
    }

    getSidePanel(): FrameLocator {
        return this.page
            .frameLocator("iframe.webview.ready")
            .last()
            .frameLocator(`iframe#active-frame[title="TestMyCode"]`)
            .last();
    }
}
