import TMC from "../api/tmc";
import WorkspaceManager from "../api/workspaceManager";
import Resources from "../config/resources";
import UI from "../ui/ui";

export type ActionContext = {
    tmc: TMC;
    ui: UI;
    resources: Resources;
    workspaceManager: WorkspaceManager;
};
