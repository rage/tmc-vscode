import Dialog from "../api/dialog";
import ExerciseDecorationProvider from "../api/exerciseDecorationProvider";
import TMC from "../api/tmc";
import WorkspaceManager from "../api/workspaceManager";
import Resources from "../config/resources";
import Settings from "../config/settings";
import { UserData } from "../config/userdata";
import { VisibilityGroups } from "../ui/types";
import UI from "../ui/ui";
import { Result } from "ts-results";

// fields may be undefined if something went wrong during initialization
export type ActionContext = {
    dialog: Dialog;
    exerciseDecorationProvider: Result<ExerciseDecorationProvider, Error>;
    resources: Result<Resources, Error>;
    settings: Settings;
    tmc: Result<TMC, Error>;
    ui: UI;
    userData: Result<UserData, Error>;
    workspaceManager: Result<WorkspaceManager, Error>;
    visibilityGroups: VisibilityGroups;
};

export type FeedbackQuestion = {
    id: number;
    kind: string;
    lower?: number;
    upper?: number;
    question: string;
};
