import * as vscode from "vscode";

export default class UI {

    public treeDP: TmcTDP;

    constructor() {
        this.treeDP = new TmcTDP();
        const tree = vscode.window.createTreeView("tmcView", {treeDataProvider: this.treeDP});
        this.treeDP.registerAction("login", true);
        this.treeDP.registerAction("logout", false);
    }

    public createUiActionHandler() {
        return (label: string) => {
            if (label === "login") {
                this.treeDP.setVisibility("logout", true);
                this.treeDP.setVisibility("login", false);
            } else if (label === "logout") {
                this.treeDP.setVisibility("logout", false);
                this.treeDP.setVisibility("login", true);
            }
            vscode.window.showInformationMessage("Activated " + label);
        };
    }
}

class TmcTDP implements vscode.TreeDataProvider<TMCAction> {

    public actions: Map<string, {action: TMCAction, visible: boolean}> = new Map();

    public uonDidChangeTreeData: vscode.EventEmitter<TMCAction | undefined> =
        new vscode.EventEmitter<TMCAction | undefined>();

    public readonly onDidChangeTreeData: vscode.Event<TMCAction | undefined> = this.uonDidChangeTreeData.event;

    public getChildren(element?: TMCAction | undefined): TMCAction[] {
        if (element === undefined) {
            const actionList: TMCAction[] = [];
            for (const action of this.actions) {
                if (action[1].visible) {
                    actionList.push(action[1].action);
                }
            }
            return actionList;
        }
        return [];
    }

    public getTreeItem(element: TMCAction) {
        return element;
    }

    public registerAction(label: string, visible: boolean) {
        if (this.actions.get(label) !== undefined) {
            return;
        }

        if (visible === undefined) {
            visible = false;
        }
        this.actions.set(label, {action: new TMCAction(label,
             {command: "tmcView.activateEntry", title: "", arguments: [label]}), visible});
        this.refresh();
    }

    public setVisibility(label: string, visible: boolean) {
        for (const action of this.actions) {
            if (action[0] === label) {
                if (action[1].visible !== visible) {
                    action[1].visible = visible;
                    this.refresh();
                }
                return;
            }
        }
    }

    private refresh(): void {
        this.uonDidChangeTreeData.fire();
    }

}

class TMCAction extends vscode.TreeItem {

    constructor(label: string, command?: vscode.Command) {
        super(label);
        this.command = command;
    }

}
