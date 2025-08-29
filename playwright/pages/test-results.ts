import { TmcPage } from "./tmc";
import { FrameLocator, Page } from "@playwright/test";

export class TestResultsPage extends TmcPage {
    constructor(
        public readonly page: Page,
        public readonly webview: FrameLocator,
    ) {
        super(page, webview);
    }

    async submit(): Promise<void> {
        await this.getWebview()
            .getByRole("button", { name: "Send solution to server" })
            .first()
            .click();
    }

    getWebview(): FrameLocator {
        return this.getSidePanel();
    }
}
