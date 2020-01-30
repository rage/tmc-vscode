import * as vscode from "vscode";
import * as init from "./init";

import TMC from "./api/tmc";
import Storage from "./config/storage";
import UI from "./ui/ui";

export async function activate(context: vscode.ExtensionContext) {

    console.log('Congratulations, your extension "tmc-vscode" is now active!');

    const result = await init.firstTimeInitialization(context);
    if (result.ok) {
        const ui = new UI(context);
        const storage = new Storage(context);
        const tmc = new TMC(storage, context);

        init.registerUiActions(context, ui, storage, tmc);

        context.subscriptions.push(
            vscode.commands.registerCommand("tmcView.activateEntry", ui.createUiActionHandler()),
        );
    } else {
        vscode.window.showErrorMessage("Something broke: " + result.val.message);
    }
}

export function deactivate() {}
