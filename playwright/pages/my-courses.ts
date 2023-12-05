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

        await this.getSidePanel()
            .getByRole("heading", { name: "Test Organization (test)" })
            .click();

        await this.getSidePanel().getByRole("heading", { name }).click();
    }

    async selectCourse(name: string): Promise<void> {
        await this.webview.getByRole("heading", { name }).click();
    }
}
