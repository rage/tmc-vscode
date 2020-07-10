import { expect } from "chai";
import {
    ActivityBar,
    By,
    EditorView,
    VSBrowser,
    WebDriver,
    WebElement,
} from "vscode-extension-tester";

import { openTMCSideBar, operateTMCWebview } from "./navigation";

describe("Introductory tests", () => {
    let activityBar: ActivityBar;
    let driver: WebDriver;
    let editorView: EditorView;

    before(() => {
        activityBar = new ActivityBar();
        driver = VSBrowser.instance.driver;
        editorView = new EditorView();
    });

    it("Activity Bar contains TMC icon", () => {
        activityBar.getViewControl("TestMyCode");
    });

    it("Clicking activity bar provides TMC treeview", () => {
        const test = async (): Promise<void> => {
            await openTMCSideBar(activityBar, 10000);
        };
        return new Promise((resolve, reject) => test().then(resolve).catch(reject));
    }).timeout(10000);

    it("Trying to log in with wrong credentials gives error", () => {
        const test = async (): Promise<void> => {
            const buttons = await openTMCSideBar(activityBar, 1000);
            const loginButton = buttons.get("Log in") as WebElement;
            expect(loginButton).to.be.instanceOf(
                WebElement,
                "Expected to find WebElement `Log in`",
            );

            loginButton.click();
            await operateTMCWebview(editorView, async (webview) => {
                await webview
                    .findWebElements(By.css("[data-se='error-notification']"))
                    .then((ns) => {
                        expect(ns.length).to.be.equal(
                            0,
                            "There shouldn't be any error notifications when entering login page.",
                        );
                    });
                await webview
                    .findWebElement(By.css("[data-se='username']"))
                    .then((u) => u.sendKeys("TestMyCode"));
                await webview
                    .findWebElement(By.css("[data-se='password']"))
                    .then((p) => p.sendKeys("hunter2"));
                await webview.findWebElement(By.css("[data-se='submit']")).then((s) => s.click());
            });
            await operateTMCWebview(editorView, async (webview) => {
                const error = (await driver.wait(async () => {
                    const errors = await webview.findWebElements(
                        By.css("[data-se='error-notification']"),
                    );
                    return errors.length > 0 ? errors[0] : undefined;
                }, 1000)) as WebElement;
                expect(await error.getCssValue("display")).to.be.equal(
                    "block",
                    "Error notification expected when using wrong credentials.",
                );
            });
        };
        return new Promise((resolve, reject) => test().then(resolve).catch(reject));
    }).timeout(10000);
});
