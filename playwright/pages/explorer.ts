import { Page } from "@playwright/test";

export class ExplorerPage {
    constructor(public readonly page: Page) {}

    async openFile(filename: string): Promise<void> {
        // first, let's make sure that the target isn't a directory that's already open,
        // as naively clicking it would close it
        const isOpenDir = await this.page
            // selects the file explorer sidebar
            .locator(".explorer-folders-view")
            // selects collapsible elements in the sidebar that are not collapsed
            .locator("div.collapsible:not(.collapsed) + div")
            // gets an expanded collapsible element with the name we're looking for
            .getByText(filename)
            .isVisible();
        if (isOpenDir) {
            // if the target is an open directory, we shouldn't click it because that would close it
            return;
        }

        // otherwise, click it
        this.page
            // selects the file explorer sidebar
            .locator(".explorer-folders-view")
            // selects the actual file
            .getByText(filename)
            .click();
    }
}
