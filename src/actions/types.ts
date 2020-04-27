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

export type CourseExerciseDownloads = {
    courseId: number;
    exerciseIds: number[];
    organizationSlug: string;
};

export type FeedbackQuestion = {
    id: number;
    kind: string;
    lower?: number;
    upper?: number;
    question: string;
};
