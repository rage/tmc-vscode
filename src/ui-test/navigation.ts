import { ActivityBar, EditorView, WebElement, WebView } from "vscode-extension-tester";

import { waitForElements } from "./utils";

/**
 * Navigates to TMC Sidebar and returns a map of avaiable ViewItems.
 */
const openTMCSideBar = async (
    activityBar: ActivityBar,
    timeout?: number,
): Promise<Map<string, WebElement>> => {
    const content = (await activityBar.getViewControl("TestMyCode").openView()).getContent();
    const sections = await waitForElements(() => content.getSections());
    const elements = await waitForElements(() => sections[0].getVisibleItems(), undefined, timeout);

    return new Map<string, WebElement>(
        await Promise.all(
            elements.map<Promise<[string, WebElement]>>(async (i) => [await i.getText(), i]),
        ),
    );
};

/**
 * Gets the visible TMC webview and provides it to the operation function with proper context.
 * Cleans up afterwards.
 */
const operateTMCWebview = async (
    editorView: EditorView,
    title: string,
    groupIndex: number,
    operation: (weview: WebView) => Promise<void>,
): Promise<void> => {
    const webview = (await editorView.openEditor(title, groupIndex)) as WebView;
    await webview.switchToFrame();
    await operation(webview);
    await webview.switchBack();
};

export { openTMCSideBar, operateTMCWebview };
