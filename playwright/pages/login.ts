import { FrameLocator, Page } from "@playwright/test";

import { TmcPage } from "./tmc";

export class LoginPage extends TmcPage {
    constructor(
        public readonly page: Page,
        public readonly webview: FrameLocator,
    ) {
        super(page, webview);
    }

    async goto(): Promise<void> {
        await this.openMenu();
        await this.page.getByRole("treeitem", { name: "Log in" }).locator("a").click();
    }

    async login(user: string): Promise<void> {
        await this.webview.getByLabel("Email or username:").fill(user);
        await this.webview.getByLabel("Password:").fill(user);
        await this.webview.getByRole("button", { name: "Submit" }).click();
    }
}
