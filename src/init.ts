import * as fs from "fs";
import * as handlebars from "handlebars";
import * as path from "path";
import * as vscode from "vscode";
import TMC from "./api/tmc";
import UI from "./ui/ui";

import { AuthenticationError } from "./errors";

/**
 * Registers the various actions and handlers required for the user interface to function.
 * Should only be called once.
 *
 * TODO: split up into reasonable pieces as functionality expands
 * @param ui The User Interface object
 * @param tmc The TMC API object
 */
export function registerUiActions(extensionContext: vscode.ExtensionContext, ui: UI, tmc: TMC) {

    ui.treeDP.registerVisibilityGroup("loggedIn", tmc.isAuthenticated());

    // Logs out, closes the webview, hides the logout command, shows the login command
    ui.treeDP.registerAction("Log out", ["loggedIn"], () => {
        tmc.deauthenticate();
        ui.webview.dispose();
        ui.treeDP.updateVisibility(["!loggedIn"]);
    });

    // Displays the login webview
    ui.treeDP.registerAction("Log in", ["!loggedIn"], async () => {
        ui.webview.setContent(await getTemplate(extensionContext, "login"));
    });

    // Receives a login information from the webview, attempts to log in
    // If successful, show the logout command instead of the login one, and a temporary webview page
    ui.webview.registerHandler("login", async (msg: { type: string, username: string, password: string }) => {
        console.log("Logging in as " + msg.username);
        const result = await tmc.authenticate(msg.username, msg.password);
        if (result.ok) {
            console.log("Logged in successfully");
            ui.treeDP.updateVisibility(["loggedIn"]);
            ui.webview.setContent("Logged in.");
        } else {
            console.log("Login failed: " + result.val.message);
            if (result.val instanceof AuthenticationError) {
                console.log("auth error");
            }
            ui.webview.setContent(await getTemplate(extensionContext, "login", {error: result.val.message}));
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
async function getTemplate(extensionContext: vscode.ExtensionContext, name: string, data?: any): Promise<string> {

    const p = path.join(extensionContext.extensionPath, "resources/templates/" + name + ".html");
    const template = handlebars.compile(fs.readFileSync(p, "utf8"));
    if (!data) {
        data = {};
    }
    data.cssPath = resolvePath(extensionContext, "resources/style.css");
    data.test = "login";

    return template(data);
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
