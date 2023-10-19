/**
 * Various utility functions and types for Svelte <script>s
 */

import { Writable, writable } from "svelte/store";
import {
    ExtensionToWebview,
    MyCoursesPanel,
    Panel,
    PanelType,
    SpecificPanel,
    TargetedExtensionToWebview,
    WebviewToExtension,
} from "../shared";
import { vscode } from "./vscode";

/**
 * Message from the extension host or a webview.
 */
type MessageToWebview = ExtensionToWebview | WebviewToWebview;

/**
 * Message from webview to webview.
 */
type WebviewToWebview = {
    source: "webview";
    panelId: number;
    panelType: MyCoursesPanel["type"];
    message: WebviewToMyCourses;
};

type WebviewToMyCourses =
    | {
          type: "selectedOrganization";
          slug: string;
      }
    | {
          type: "selectedCourse";
          organizationSlug: string;
          courseId: number;
      };

export type TargetedWebviewToWebview<T extends PanelType> = (WebviewToWebview & {
    panelType: T;
})["message"];

/**
 * Convenience function for writable Svelte stores with an `undefined` starting value. The actual value is "loaded" later.
 */
export function loadable<T>(): Writable<T | undefined> {
    return writable(undefined);
}

/**
 * Convenience function for listening to messages from the extension host to the webview.
 * Sends a "ready" message after adding the event listener to indicate that it's ready to receive messages.
 */
// the generics make this look a little convoluted, but the idea is that
// the callback takes a message targeted at the panel argument
export function addExtensionMessageListener<T extends Panel["type"]>(
    panel: SpecificPanel<T>,
    callback: (message: TargetedExtensionToWebview<T>) => void,
) {
    window.addEventListener("message", (event) => {
        const message: MessageToWebview = event.data;
        if (message.source === "extensionHost") {
            if (message.panelId === panel.id) {
                // TS does not recognise this as a valid "TargetedExtensionToWebview<T>" without the override
                callback(message.message as TargetedExtensionToWebview<T>);
            }
        }
    });
    vscode.postMessage({
        type: "ready",
        panel,
    });
}

/**
 * Convenience function for listening to messages from the webview to the webview.
 */
export function addWebviewMessageListener<T extends Panel["type"]>(
    panel: SpecificPanel<T>,
    callback: (message: TargetedWebviewToWebview<T>) => void,
) {
    window.addEventListener("message", (event) => {
        console.log("got some msg", JSON.stringify(event, null, 2));
        const message: MessageToWebview = event.data;
        if (message.source === "webview") {
            if (message.panelId === panel.id) {
                callback(message.message);
            }
        }
    });
}

/**
 * Posts a message to another webview.
 */
export function postMessageToWebview<T extends Panel["type"]>(
    panel: SpecificPanel<T>,
    message: TargetedWebviewToWebview<T>,
) {
    // TS does not recognise this as a valid "WebviewToWebview" without the override
    const messageToWebview: WebviewToWebview = {
        source: "webview",
        panelId: panel.id,
        panelType: panel.type,
        message,
    } as WebviewToWebview;
    // relay the message through the extension host
    const webviewToExtension: WebviewToExtension = {
        type: "relayToWebview",
        message: messageToWebview,
    };
    vscode.postMessage(webviewToExtension);
}
