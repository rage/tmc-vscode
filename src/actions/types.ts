import { StatusBarItem } from "vscode";
import TMC from "../api/tmc";
import WorkspaceManager from "../api/workspaceManager";
import Resources from "../config/resources";
import { UserData } from "../config/userdata";
import UI from "../ui/ui";

export type ActionContext = {
    tmc: TMC;
    ui: UI;
    resources: Resources;
    workspaceManager: WorkspaceManager;
    userData: UserData;
};
