import * as ejs from "ejs";
import * as path from "path";
import * as vscode from "vscode";
import TMC from "./api/tmc";
import UI from "./ui/ui";

/**
 * Registers the various actions and handlers required for the user interface to function.
 * Should only be called once.
 *
 * TODO: split up into reasonable pieces as functionality expands
 * @param ui The User Interface object
 * @param tmc The TMC API object
 */
export function registerUiActions(extensionContext: vscode.ExtensionContext, ui: UI, tmc: TMC) {

    // Logs out, closes the webview, hides the logout command, shows the login command
    ui.treeDP.registerAction("logout", () => {
        tmc.deauthenticate();
        ui.webview.dispose();
        ui.treeDP.setVisibility("logout", false);
        ui.treeDP.setVisibility("login", true);
    }, tmc.isAuthenticated());

    // Displays the login webview
    ui.treeDP.registerAction("login", () => {
        ui.webview.setContent(getTemplate(extensionContext, "login", {error: undefined}));
    }, !tmc.isAuthenticated());

    // Receives a login information from the webview, attempts to log in
    // If successful, show the logout command instead of the login one, and a temporary webview page
    ui.webview.registerHandler("login", async (msg: { type: string, username: string, password: string }) => {
        console.log("Logging in as " + msg.username);
        const result = await tmc.authenticate(msg.username, msg.password);
        if (result.success) {
            console.log("Logged in successfully");
            ui.treeDP.setVisibility("login", false);
            ui.treeDP.setVisibility("logout", true);
            ui.webview.setContent("Logged in.");
        } else {
            console.log("Login failed: " + result.errorDesc);
            ui.webview.setContent(getTemplate(extensionContext, "login", {error: result.errorDesc}));
        }
    });
}

/**
 * Creates an HTML document from a template, with a default CSS applied
 *
 * @param extensionContext
 * @param name Name of the template file to user
 * @param data Must contain all the variables used in the template
 *
 * @returns The HTML document as a string
 */
function getTemplate(extensionContext: vscode.ExtensionContext, name: string, data: ejs.Data): string {

    data.cssPath = resolvePath(extensionContext, "resources/style.css");

    return ejs.render(ejs.fileLoader("resources/templates/" + name + ".ejstemplate").toString(), data, {});
}

/**
 * Creates an absolute path from a relative one for use in webviews
 *
 * @param extensionContext
 * @param relativePath Path to resolve
 *
 * @returns the absolute path
 */
function resolvePath(extensionContext: vscode.ExtensionContext, relativePath: string): string {
    return vscode.Uri.file(path.join(extensionContext.extensionPath, relativePath)).toString().replace("file:", "vscode-resource:");
}
