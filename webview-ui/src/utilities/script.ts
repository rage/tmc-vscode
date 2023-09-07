import { Writable, writable } from "svelte/store";
import { MessageToWebview } from "../shared";

/**
 * Convenience function for writable Svelte stores with an `undefined` starting value. The actual value is "loaded" later.
 */
export function loadable<T>(): Writable<T | undefined> {
    return writable(undefined);
}

/**
 * Convenience function for listening to messages from the extension host to the webview.
 */
export function addMessageListener(callback: (message: MessageToWebview) => void) {
    window.addEventListener("message", (event) => {
        const message: MessageToWebview = event.data;
        callback(message);
    });
}
