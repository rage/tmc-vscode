import TMC from "../api/tmc";
import WorkspaceManager from "../api/workspaceManager";
import Resources from "../config/resources";
import Settings from "../config/settings";
import { UserData } from "../config/userdata";
import TemporaryWebviewProvider from "../ui/temporaryWebviewProvider";
import UI from "../ui/ui";
import Logger from "../utils/logger";

export type ActionContext = {
    logger: Logger;
    resources: Resources;
    settings: Settings;
    temporaryWebviewProvider: TemporaryWebviewProvider;
    tmc: TMC;
    ui: UI;
    userData: UserData;
    workspaceManager: WorkspaceManager;
};

/**
 * Required details for downloading exercises of a specific course.
 */
export interface CourseExerciseDownloads {
    courseId: number;
    exerciseIds: number[];
    organizationSlug: string;
}

export type FeedbackQuestion = {
    id: number;
    kind: string;
    lower?: number;
    upper?: number;
    question: string;
};
