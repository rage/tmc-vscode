import * as vscode from "vscode";
import Resources from "../config/resources";
import TemplateEngine from "./templateEngine";
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

    /**
     * Creates an UI object and (temporarily) initializes it with login-related content
     * @param extensionContext VSCode extension content
     */
    constructor(extensionContext: vscode.ExtensionContext, resources: Resources) {
        this.webview = new TmcWebview(extensionContext, resources);
        this.treeDP = new TmcMenuTree("tmcView");
    }

    /**
     * @return A handler callback for the tmcView.activateEntry command
     */
    public createUiActionHandler(): (onClick: () => void) => void {
        return (onClick: () => void) => {
            onClick();
        };
    }
}
