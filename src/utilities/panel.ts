import { Panel, PanelType, TargetedExtensionToWebview } from "../shared/shared";
import { Logger } from "./logger";
import { Webview } from "vscode";

/**
 * Helper function for the extension panel to render a webview panel.
 */
export async function renderPanel(panel: Panel, webview: Webview): Promise<void> {
    postMessageToWebview(webview, {
        type: "setPanel",
        target: { id: 0, type: "App" },
        panel,
    });
}

// note: this function should not be awaited
export async function postMessageToWebview<T extends PanelType>(
    webview: Webview,
    message: TargetedExtensionToWebview<T>,
): Promise<void> {
    Logger.info("Posting a message to webview", JSON.stringify(message, null, 2));
    webview.postMessage(message);
}
