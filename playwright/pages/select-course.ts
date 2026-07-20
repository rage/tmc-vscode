import { TmcPage } from "./tmc";
import { FrameLocator, Page } from "@playwright/test";

export class SelectCourse extends TmcPage {
    constructor(
        public readonly page: Page,
        public readonly webview: FrameLocator,
    ) {
        super(page, webview);
    }

    async select(course: string): Promise<void> {
        await this.getSidePanel().getByRole("heading", { name: course }).click();
    }
}
