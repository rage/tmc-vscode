import { FeedbackQuestion } from "../actions/types";
import { SubmissionFinished } from "../api/langsSchema";
import Storage, { LocalCourseData } from "../api/storage";
import TMC from "../api/tmc";
import { Course, Organization } from "../api/types";
import { ExtensionSettings } from "../config/settings";
import { LogLevel } from "../utilities/logger";

import { MyCoursesProps } from "./templates/MyCourses";
import { WelcomeProps } from "./templates/Welcome";
import UI from "./ui";

export type HandlerContext = {
    tmc: TMC;
    storage: Storage;
    ui: UI;
    visibilityGroups: VisibilityGroups;
};

export type VisibilityGroups = {
    loggedIn: VisibilityGroup;
};

export type VisibilityGroup = {
    id: string;
    not: VisibilityGroupNegated;
};

export type VisibilityGroupNegated = {
    id: string;
};

export type TemplateData =
    | ({ templateName: "course-details" } & CourseDetailsData)
    | ({ templateName: "course" } & CourseData)
    | ({ templateName: "error" } & ErrorData)
    | { templateName: "login" }
    | ({ templateName: "my-courses" } & MyCoursesProps)
    | ({ templateName: "organization" } & OrganizationData)
    | ({ templateName: "running-tests" } & RunningTestsData)
    | { templateName: "settings" }
    | ({ templateName: "submission-result" } & SubmissionResultData)
    | ({ templateName: "submission-status" } & SubmissionStatusData)
    | ({ templateName: "test-result" } & TestResultData)
    | ({ templateName: "welcome" } & WelcomeProps);

export type CourseDetailsData = {
    course: LocalCourseData;
    courseId: number;
    exerciseData: CourseDetailsExerciseGroup[];
    offlineMode: boolean;
};

export type CourseDetailsExerciseGroup = {
    name: string;
    nextDeadlineString: string;
    exercises: CourseDetailsExercise[];
};

export type CourseDetailsExercise = {
    id: number;
    name: string;
    passed: boolean;
    softDeadline: Date | null;
    softDeadlineString: string;
    hardDeadline: Date | null;
    hardDeadlineString: string;
    isHard: boolean;
};

export type CourseData = {
    courses: Course[];
    organization: Organization;
};

export type ErrorData = {
    error: Error;
};

export type LoginData = {
    error?: string;
};

export type OrganizationData = {
    organizations: Organization[];
    pinned: Organization[];
};

export type RunningTestsData = {
    exerciseName: string;
};

export type SettingsData = {
    extensionSettings: ExtensionSettings;
    tmcDataSize: string;
};

export type SubmissionResultData = {
    statusData: SubmissionFinished;
    feedbackQuestions: FeedbackQuestion[];
    submissionUrl: string | undefined;
};

export type SubmissionStatusData = {
    messages: string[];
    progressPct: number;
    submissionUrl: string | undefined;
};

export type TestResultData = {
    testResult: unknown;
    id: number;
    courseSlug: string;
    exerciseName: string;
    tmcLogs: {
        stdout?: string;
        stderr?: string;
    };
    pasteLink?: string;
    disabled?: boolean;
};

export type ExerciseStatus =
    | "closed"
    | "downloading"
    | "downloadFailed"
    | "expired"
    | "missing"
    | "new"
    | "opened";

export interface ExerciseStatusChange {
    command: "exerciseStatusChange";
    exerciseId: number;
    status: ExerciseStatus;
}

export interface SetDataFolder {
    command: "setTmcDataFolder";
    path: string;
    diskSize: string;
}

export interface LoginError {
    command: "loginError";
    error: string;
}

export interface SetCourseDisabledStatus {
    command: "setCourseDisabledStatus";
    courseId: number;
    disabled: boolean;
}

export interface SetBooleanSetting {
    command: "setBooleanSetting";
    setting: "downloadOldSubmission" | "hideMetaFiles" | "insider" | "updateExercisesAutomatically";
    enabled: boolean;
}

export interface SetLogLevel {
    command: "setLogLevel";
    level: LogLevel;
}

export interface SetNextCourseDeadline {
    command: "setNextCourseDeadline";
    deadline: string;
    courseId: number;
}

export interface SetNewExercises {
    command: "setNewExercises";
    courseId: number;
    exerciseIds: number[];
}

export interface SetUpdateables {
    command: "setUpdateables";
    exerciseIds: number[];
    courseId: number;
}

export type WebviewMessage =
    | ExerciseStatusChange
    | LoginError
    | SetBooleanSetting
    | SetCourseDisabledStatus
    | SetDataFolder
    | SetNextCourseDeadline
    | SetNewExercises
    | SetLogLevel
    | SetUpdateables;
