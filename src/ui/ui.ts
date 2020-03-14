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

    private statusbar: vscode.StatusBarItem;
    private statusBarTimeout: NodeJS.Timeout;

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
        this.statusbar = statusbaritem;
        this.statusBarTimeout = setTimeout(() => {}, 0);
    }

    /**
     * @return A handler callback for the tmcView.activateEntry command
     */
    public createUiActionHandler(): (onClick: () => void) => void {
        return (onClick: () => void) => {
            onClick();
        };
    }

    public setStatusBar(text: string, timeout?: number) {
        clearTimeout(this.statusBarTimeout);
        if (timeout) {
            this.statusbar.text = `${text}`;
            this.statusBarTimeout = setTimeout(() => {
                this.statusbar.hide();
            }, timeout);
        } else {
            this.statusbar.text = `${text}`;
        }
        this.statusbar.show();
    }

    public hideStatusBar() {
        this.statusbar.hide();
    }
}
