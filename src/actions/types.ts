import Dialog from "../api/dialog";
import { ExerciseDecorationProvider } from "../api/exerciseDecorationProvider";
import TMC from "../api/tmc";
import WorkspaceManager from "../api/workspaceManager";
import Resources from "../config/resources";
import Settings from "../config/settings";
import { UserData } from "../config/userdata";
import TemporaryWebviewProvider from "../ui/temporaryWebviewProvider";
import { VisibilityGroups } from "../ui/types";
import UI from "../ui/ui";

export type ActionContext = {
    dialog: Dialog;
    exerciseDecorationProvider: ExerciseDecorationProvider;
    resources: Resources;
    settings: Settings;
    temporaryWebviewProvider: TemporaryWebviewProvider;
    tmc: TMC;
    ui: UI;
    userData: UserData;
    workspaceManager: WorkspaceManager;
    visibilityGroups: VisibilityGroups;
};

export type FeedbackQuestion = {
    id: number;
    kind: string;
    lower?: number;
    upper?: number;
    question: string;
};
