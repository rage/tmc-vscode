import { FrameLocator, Page } from "@playwright/test";

import { TmcPage } from "./tmc";

export class CoursePage extends TmcPage {
    constructor(
        public readonly page: Page,
        public readonly webview: FrameLocator,
    ) {
        super(page, webview);
    }

    async openWorkspace(): Promise<void> {
        await this.webview.getByRole("button", { name: "Open workspace" }).first().click();
        const yesButton = this.page.getByRole("button", { name: "Yes" }).first();
        try {
            // click yes if prompted
            await yesButton.waitFor({ timeout: 1000 });
            yesButton.click();
        } catch (_e) {
            // no-op
        }
    }

    async showExercises(): Promise<void> {
        await this.webview.getByRole("button", { name: "Show exercises" }).first().click();
    }

    async openExercises(names: string[]): Promise<void> {
        for (const name of names) {
            await this.webview.getByRole("row", { name }).getByRole("checkbox").click();
        }
        await this.webview.getByRole("button", { name: "Open", exact: true }).first().click();
    }
}
