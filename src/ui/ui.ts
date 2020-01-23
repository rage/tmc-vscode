import * as path from "path";
import * as vscode from "vscode";
import TmcTDP from "./treeview";
import {TmcWebview} from "./webview";

/**
 * A class for interacting with the user through graphical means
 */
export default class UI {

    /**
     * A TmcTDP object for interacting with the treeview panel
     */
    public treeDP: TmcTDP = new TmcTDP();
    /**
     * A Webview object for interacting with the main Webview
     */
    public webview: TmcWebview;

    /**
     * Creates an UI object and (temporarily) initializes it with login-related content
     * @param extensionContext VSCode extension content
     */
    constructor(extensionContext: vscode.ExtensionContext) {
        this.webview = new TmcWebview(extensionContext);
        this.initialize();
    }

    /**
     * @return A handler callback for the tmcView.activateEntry command
     */
    public createUiActionHandler(): (onClick: () => void) => void {
        return (onClick: () => void) => {
            onClick();
        };
    }

    /**
     * Registers a tree data provider for VSCode to use to populate the tmc actions treeview
     */
    public initialize() {
        vscode.window.registerTreeDataProvider("tmcView", this.treeDP);
    }
}
