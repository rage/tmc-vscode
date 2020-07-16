import { expect } from "chai";
import { ActivityBar, By, EditorView, WebElement } from "vscode-extension-tester";

import { fillLoginForm } from "./macros";
import { openTMCSideBar, operateTMCWebview } from "./navigation";
import { waitForElements } from "./utils";

describe("Login tests", () => {
    let activityBar: ActivityBar;
    let editorView: EditorView;

    before(() => {
        activityBar = new ActivityBar();
        editorView = new EditorView();
    });

    afterEach(async () => {
        await editorView.closeAllEditors();
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
                const errors = await webview.findWebElements(
                    By.css("[data-se='error-notification']"),
                );
                expect(errors.length).to.be.equal(
                    0,
                    "There shouldn't be any error notifications when entering login page.",
                );
                await fillLoginForm(webview, "TestMyCode", "hunter2").then((s) => s.click());
            });

            await operateTMCWebview(editorView, async (webview) => {
                const [error] = await waitForElements(() =>
                    webview.findWebElements(By.css("[data-se='error-notification']")),
                );
                expect(await error.getCssValue("display")).to.be.equal(
                    "block",
                    "Error notification expected when using wrong credentials.",
                );
            });
        };
        return new Promise((resolve, reject) => test().then(resolve).catch(reject));
    }).timeout(10000);

    it("Logging in with correct credentials works and allows to see My Courses", () => {
        const test = async (): Promise<void> => {
            const buttons = await openTMCSideBar(activityBar, 1000);
            const loginButton = buttons.get("Log in") as WebElement;
            expect(loginButton).to.be.instanceOf(
                WebElement,
                "Expected to find WebElement `Log in`",
            );

            loginButton.click();
            await operateTMCWebview(editorView, async (webview) => {
                const errors = await webview.findWebElements(
                    By.css("[data-se='error-notification']"),
                );
                expect(errors.length).to.be.equal(
                    0,
                    "There shouldn't be any error notifications when entering login page.",
                );
                await fillLoginForm(webview, "TestMyExtension", "hunter2").then((s) => s.click());
            });

            await operateTMCWebview(editorView, async (webview) => {
                const headers = await waitForElements(
                    () => webview.findWebElements(By.css("h1")),
                    async (e) => (await e.getText()) === "My courses",
                );
                expect(headers.length).to.be.equal(1);
            });
        };
        return new Promise((resolve, reject) => test().then(resolve).catch(reject)).finally();
    }).timeout(10000);
});
