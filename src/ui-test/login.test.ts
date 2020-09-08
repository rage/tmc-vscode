import { expect } from "chai";
import { ActivityBar, By, EditorView, WebElement } from "vscode-extension-tester";

import { fillLoginForm } from "./macros";
import { openTMCSideBar, operateTMCWebview } from "./navigation";
import { waitForElements } from "./utils";

describe("Login tests", function () {
    let activityBar: ActivityBar;
    let editorView: EditorView;

    before(async function () {
        activityBar = new ActivityBar();
        editorView = new EditorView();
        await editorView.closeAllEditors();
    });

    afterEach(async function () {
        await editorView.closeAllEditors();
    });

    it("Activity Bar contains TMC icon", () => {
        activityBar.getViewControl("TestMyCode");
    });

    it("Clicking activity bar provides TMC treeview", () => {
        const test = async (): Promise<void> => {
            await openTMCSideBar(activityBar);
        };
        return new Promise((resolve, reject) => test().then(resolve).catch(reject));
    }).timeout(10000);

    it("Trying to log in with wrong credentials gives error", function () {
        const test = async (): Promise<void> => {
            const buttons = await openTMCSideBar(activityBar, 1000);
            const loginButton = buttons.get("Log in") as WebElement;
            expect(loginButton).to.be.instanceOf(
                WebElement,
                "Expected to find WebElement `Log in`",
            );

            loginButton.click();
            await operateTMCWebview(editorView, "TestMyCode", 0, async (webview) => {
                const error = await webview.findWebElement(
                    By.css("[data-se='error-notification']"),
                );
                expect(await error.getCssValue("display")).to.be.equal(
                    "none",
                    "Error notification should not be displayed.",
                );
                await (await fillLoginForm(webview, "TestMyCode", "hunter2")).click();
                const [error2] = await waitForElements(() =>
                    webview.findWebElements(By.css("[data-se='error-notification']")),
                );
                expect(await error2.getCssValue("display")).to.be.equal(
                    "block",
                    "Error notification expected when using wrong credentials.",
                );
            });
        };
        return new Promise((resolve, reject) => test().then(resolve).catch(reject));
    }).timeout(10000);

    it("Logging in with correct credentials works and allows to see My Courses", function () {
        const test = async (): Promise<void> => {
            const buttons = await openTMCSideBar(activityBar);
            const loginButton = buttons.get("Log in") as WebElement;
            expect(loginButton).to.be.instanceOf(
                WebElement,
                "Expected to find WebElement `Log in`",
            );

            loginButton.click();
            await operateTMCWebview(editorView, "TestMyCode", 0, async (webview) => {
                const errors = await webview.findWebElements(
                    By.css("[data-se='error-notification']"),
                );
                expect(errors.length).to.be.equal(
                    0,
                    "There shouldn't be any error notifications when entering login page.",
                );
                await (await fillLoginForm(webview, "TestMyExtension", "hunter2")).click();
            });

            await operateTMCWebview(editorView, "TestMyCode", 0, async (webview) => {
                const headers = await waitForElements(
                    () => webview.findWebElements(By.css("h1")),
                    async (e) => (await e.getText()) === "My Courses",
                );
                expect(headers.length).to.be.equal(1);
            });
        };
        return new Promise((resolve, reject) => test().then(resolve).catch(reject)).finally();
    }).timeout(10000);
});

// Didn't run as a separate file, figure out later
describe("Course page tests", function () {
    let activityBar: ActivityBar;
    let editorView: EditorView;

    before("Log in before test suite", async function () {
        this.timeout(10000);
        activityBar = new ActivityBar();
        editorView = new EditorView();
        const buttons = await openTMCSideBar(activityBar);
        if (Array.from(buttons.keys()).find((b) => b === "Log in")) {
            await buttons.get("Log in")?.click();
            await operateTMCWebview(editorView, "TestMyCode", 0, async (webview) => {
                await (await fillLoginForm(webview, "TestMyExtension", "hunter2")).click();
            });
            await editorView.closeAllEditors();
        }
    });

    afterEach(async () => {
        await editorView.closeAllEditors();
    });

    it("Can view courses page", function () {
        const test = async (): Promise<void> => {
            const buttons = await openTMCSideBar(activityBar);
            const coursesButton = buttons.get("My Courses") as WebElement;
            expect(coursesButton).to.be.instanceOf(
                WebElement,
                "Expected to find WebElement `My Courses`",
            );

            await coursesButton.click();
            await operateTMCWebview(editorView, "TestMyCode", 0, async (webview) => {
                await webview.findWebElement(By.css("[data-se='my-courses-title']"));
            });
        };
        return new Promise((resolve, reject) => test().then(resolve).catch(reject));
    }).timeout(10000);

    // Can't get content of temp webview
    it.skip("Can add new courses to courses list", function () {
        const test = async (): Promise<void> => {
            const buttons = await openTMCSideBar(activityBar);
            const coursesButton = buttons.get("My Courses") as WebElement;
            await coursesButton.click();
            await operateTMCWebview(editorView, "TestMyCode", 0, async (webview) => {
                const courses = await webview.findWebElements(By.css("[data-se='course-card']"));
                expect(courses.length).to.be.equal(0);
                const add = await webview.findWebElement(By.css("[data-se='add-new-course']"));
                await add.click();
            });

            // await waitForElements(
            //     async () => await editorView.getOpenEditorTitles(),
            //     async (t) => t === "Select organization",
            // );
            await operateTMCWebview(editorView, "Select organization", 1, async (webview) => {
                // Fails here, actually receives content from My Courses webview??
                const pinned = await webview.findWebElements(
                    By.css("[data-se='pinned-organization-card']"),
                );
                expect(pinned.length).to.be.equal(1, "Expected to find one pinned organization");

                const all = await webview.findWebElements(By.css("[data-se='organization-card']"));
                expect(all.length).to.be.equal(2, "Expected to find 2 total organizations");

                const filter = await webview.findElement(
                    By.css("input[data-se='organization-filter']"),
                );
                await filter.sendKeys("mock");
                const all2 = await webview.findWebElements(By.css("[data-se='organization-card']"));
                expect(all2.length).to.be.equal(
                    1,
                    "Expected to find 1 total organizations after filtering",
                );
            });
        };
        return new Promise((resolve, reject) => test().then(resolve).catch(reject));
    }).timeout(10000);

    it("Can select course to view its details page");
});
