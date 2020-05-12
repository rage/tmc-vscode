import TMC from "../api/tmc";
import WorkspaceManager from "../api/workspaceManager";
import Resources from "../config/resources";
import { UserData } from "../config/userdata";
import UI from "../ui/ui";
import Logger from "../utils/logger";
import Settings from "../config/settings";

export type ActionContext = {
    tmc: TMC;
    ui: UI;
    resources: Resources;
    workspaceManager: WorkspaceManager;
    userData: UserData;
    logger: Logger;
    settings: Settings;
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
