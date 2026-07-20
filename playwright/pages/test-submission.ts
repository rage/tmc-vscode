import { TmcPage } from "./tmc";
import { FrameLocator, Page } from "@playwright/test";

export class TestSubmissionPage extends TmcPage {
    constructor(
        public readonly page: Page,
        public readonly webview: FrameLocator,
    ) {
        super(page, webview);
    }

    getWebview(): FrameLocator {
        return this.getSidePanel();
    }
}
