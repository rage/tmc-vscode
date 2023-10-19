import { Page } from "@playwright/test";

export class ExplorerPage {
    private _trusted: boolean = false;

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
        await this.page
            // selects the file explorer sidebar
            .locator(".explorer-folders-view")
            // selects the actual file
            .getByText(filename)
            .click();

        // we may get prompted for trust
        // when untrusted and opening a file
        if (!this._trusted) {
            const isDir = await this.page
                .locator(".explorer-folders-view")
                .locator("div.collapsible + div")
                .getByText(filename)
                .isVisible();
            if (!isDir) {
                this.page
                    .getByText("Yes, I trust the authors")
                    .click()
                    .then(() => {
                        this._trusted = true;
                    })
                    .catch(() => {
                        console.warn("was not asked for trust for some reason");
                    });
            }
        }
    }

    async openPath(path: string[]): Promise<void> {
        for (const file of path) {
            await this.openFile(file);
        }
    }
}
