import * as assert from "assert";
import { ActivityBar, ViewItem, ViewSection, VSBrowser, WebDriver } from "vscode-extension-tester";

describe("Activity Bar tests", () => {
    const TMC_VIEW_CONTROL = "TestMyCode";
    const TMC_VIEW_CONTROL_TITLE = "TESTMYCODE: MENU";

    let activityBar: ActivityBar;
    let driver: WebDriver;

    before(() => {
        activityBar = new ActivityBar();
        driver = VSBrowser.instance.driver;
    });

    it("Activity Bar contains TMC icon", () => {
        activityBar.getViewControl(TMC_VIEW_CONTROL);
    });

    it("Clicking activity bar provides TMC treeview", () => {
        const test = async (): Promise<void> => {
            const viewControl = activityBar.getViewControl(TMC_VIEW_CONTROL);
            const sideBar = await viewControl.openView();
            const titlePart = sideBar.getTitlePart();
            assert.strictEqual(await titlePart.getTitle(), TMC_VIEW_CONTROL_TITLE);

            const sections = (await driver.wait(async () => {
                const sections = await sideBar.getContent().getSections();
                return sections.length > 0 ? sections : undefined;
            }, 30000)) as ViewSection[];
            const buttons = (await driver.wait(async () => {
                const items = await sections[0].getVisibleItems();
                return items.length > 0 ? items : undefined;
            }, 30000)) as ViewItem[];
            if (!buttons) {
                assert.fail();
            }
        };
        return new Promise((resolve) => test().then(resolve));
    }).timeout(60000);
});
