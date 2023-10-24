import { FrameLocator, Page } from "@playwright/test";

import { TmcPage } from "./tmc";

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
