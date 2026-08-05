import { ExtensionToWebview, Panel } from "../shared/shared";
import { Logger } from "./logger";
import { Webview } from "vscode";

/**
 * Helper function for the extension panel to render a webview panel.
 */
export async function renderPanel(panel: Panel, webview: Webview): Promise<void> {
    const sent = postMessageToWebview(webview, {
        type: "setPanel",
        target: { id: 0, type: "App" },
        panel,
    });
    sent.then((delivered) => {
        if (delivered) {
            Logger.debug(`Webview panel set to "${panel.type}"`);
        }
    });
}

// note: this function should not be awaited; the returned Thenable is for callers that want to
// know whether the message was delivered, not to gate on it
export function postMessageToWebview(
    webview: Webview,
    message: ExtensionToWebview,
    context = "webview",
): Thenable<boolean> {
    // full payloads (e.g. test results with embedded build logs) are too large for info level
    Logger.info(`Posting a message to ${context}: "${message.type}"`);
    Logger.debug("Message contents", JSON.stringify(message, null, 2));
    const sent = webview.postMessage(message);
    sent.then((delivered) => {
        if (!delivered) {
            Logger.warn(`${context} did not receive message of type "${message.type}"`);
        }
    });
    return sent;
}
