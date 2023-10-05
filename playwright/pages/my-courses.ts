import { FrameLocator, Page } from "@playwright/test";

import { TmcPage } from "./tmc";

export class MyCoursesPage extends TmcPage {
    constructor(
        public readonly page: Page,
        public readonly webview: FrameLocator,
    ) {
        super(page, webview);
    }

    async goto(): Promise<void> {
        await this.openMenu();
        await this.page.getByRole("treeitem", { name: "My Courses" }).locator("a").click();
    }

    async addNewCourse(name: string): Promise<void> {
        await this.webview.getByRole("button", { name: "Add new course" }).click();

        // this wait lets the next frame load properly
        // interacting with it too quickly causes it to get stuck for an unknown reason
        // we should be able to fix it with the new svelte implementation
        await this.page.waitForTimeout(1000);
        await this.getFrame("Select organization")
            .getByRole("heading", { name: "Test Organization (test)" })
            .click();

        await this.getFrame("Select course").getByRole("heading", { name }).click();
        // this wait lets the next frame load properly
        // interacting with it too quickly causes it to get stuck for an unknown reason
        await this.page.waitForTimeout(500);
    }

    async selectCourse(name: string): Promise<void> {
        await this.webview.getByRole("heading", { name }).click();
    }
}
