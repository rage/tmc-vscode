import { FrameLocator, Page } from "@playwright/test";

import { TmcPage } from "./tmc";

export class SelectOrganization extends TmcPage {
    constructor(
        public readonly page: Page,
        public readonly webview: FrameLocator,
    ) {
        super(page, webview);
    }

    async select(org: string): Promise<void> {
        await this.getSidePanel().getByRole("heading", { name: org }).click();
    }
}
