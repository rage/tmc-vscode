import { FrameLocator, Page } from "@playwright/test";

import { SelectCourse } from "./select-course";
import { SelectOrganization } from "./select-organization";
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
        await this.webview.getByRole("button", { name: "Add new course" }).first().click();

        const selectOrganization = new SelectOrganization(this.page, this.webview);
        await selectOrganization.select("Test Organization (test)");
        // wait for the organization selection page to close
        await this.page.waitForTimeout(200);

        const selectCourse = new SelectCourse(this.page, this.webview);
        await selectCourse.select(name);
    }

    async selectCourse(name: string): Promise<void> {
        await this.webview.getByRole("heading", { name }).click();
    }
}
