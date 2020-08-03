import * as vscode from "vscode";

import Resources from "../config/resources";

import TmcMenuTree from "./treeview/treeview";
import TmcWebview from "./webview";

/**
 * A class for interacting with the user through graphical means
 */
export default class UI {
    /**
     * A TmcTDP object for interacting with the treeview panel
     */
    public treeDP: TmcMenuTree;
    /**
     * A Webview object for interacting with the main Webview
     */
    public webview: TmcWebview;

    private _statusbar: vscode.StatusBarItem;
    private _statusBarTimeout: NodeJS.Timeout;

    /**
     * Creates an UI object and (temporarily) initializes it with login-related content
     * @param extensionContext VSCode extension content
     */
    constructor(
        extensionContext: vscode.ExtensionContext,
        resources: Resources,
        statusbaritem: vscode.StatusBarItem,
    ) {
        this.webview = new TmcWebview(extensionContext, resources);
        this.treeDP = new TmcMenuTree("tmcView");
        this._statusbar = statusbaritem;
        this._statusBarTimeout = setTimeout(() => {}, 0);
    }

    /**
     * @return A handler callback for the tmcView.activateEntry command
     */
    public createUiActionHandler(): (onClick: () => void) => void {
        return (onClick: () => void): void => {
            onClick();
        };
    }

    public setStatusBar(text: string, timeout?: number): void {
        clearTimeout(this._statusBarTimeout);
        if (timeout) {
            this._statusbar.text = `${text}`;
            this._statusBarTimeout = setTimeout(() => {
                this._statusbar.hide();
            }, timeout);
        } else {
            this._statusbar.text = `${text}`;
        }
        this._statusbar.show();
    }

    public hideStatusBar(): void {
        this._statusbar.hide();
    }
}
