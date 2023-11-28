/**
 * Various utility functions and types for Svelte <script>s
 */

import { Writable, writable } from "svelte/store";
import {
    ExtensionToWebview,
    MyCoursesPanel,
    Panel,
    TargetPanel,
    Targeted,
    WebviewToExtension,
} from "../shared/shared";
import { vscode } from "./vscode";

/**
 * Message from the extension host or a webview.
 */
type Message = ExtensionToWebview | WebviewToWebview;

/**
 * Message from webview to webview.
 */
type WebviewToWebview =
    | {
          type: "selectedOrganization";
          target: TargetPanel<MyCoursesPanel>;
          slug: string;
      }
    | {
          type: "selectedCourse";
          target: TargetPanel<MyCoursesPanel>;
          organizationSlug: string;
          courseId: number;
      };

type TargetedMessage<T extends Panel> = Targeted<Message, T["type"]>;

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
export function addMessageListener<T extends Panel>(
    listeningPanel: T,
    callback: (message: TargetedMessage<T>) => void,
) {
    window.addEventListener("message", (event) => {
        const message: Message = event.data;
        // if no target id is given, accept all messages
        // if a target id is given, only accept messages with the correct id
        const correctType = message.target.type === listeningPanel.type;
        if (correctType && (!("id" in message.target) || message.target.id === listeningPanel.id)) {
            callback(message as TargetedMessage<T>);
        }
    });
    vscode.postMessage({
        type: "ready",
        panel: listeningPanel,
    });
}

/**
 * Posts a message to another webview.
 */
export function postMessageToWebview(message: WebviewToWebview) {
    // relay the message through the extension host
    const webviewToExtension: WebviewToExtension = {
        type: "relayToWebview",
        message,
    };
    vscode.postMessage(webviewToExtension);
}
