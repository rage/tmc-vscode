/*
 * ======== state ========
 */
import {
    Course,
    Organization,
    RunResult,
    StyleValidationResult,
    SubmissionFinished,
} from "./langsSchema";
import * as util from "node:util";
import { createIs } from "typia";
import { Uri } from "vscode";

/**
 * Contains the state of the webview.
 */
export type State = {
    panel: Panel;
};

/*
 * ======== panels ========
 */

/**
 * Represents a panel that is rendered by the webview.
 *
 * `id`: used to make sure messages are delivered to the correct panels
 */
export type Panel =
    | AppPanel
    | WelcomePanel
    | LoginPanel
    | MyCoursesPanel
    | CourseDetailsPanel
    | SelectOrganizationPanel
    | SelectCoursePanel
    | ExerciseTestsPanel
    | ExerciseSubmissionPanel
    | InitializationErrorHelpPanel;

export type PanelType = Panel["type"];

// used to define messages that should only be sent to a specific instance of a panel
// for example, the course selected by the user on the SelectCoursePanel should only be sent
// to the panel which initiated the course selection
export type TargetPanel<T extends Panel> = Pick<Extract<Panel, { type: T["type"] }>, "id" | "type">;

// used to define messages that should be sent to any instance of a given panel type
// for example, a change in an exercise's status should be sent to all panels that display the status
export type BroadcastPanel<T extends Panel> = Pick<Extract<Panel, { type: T["type"] }>, "type">;

export type AppPanel = {
    id: number;
    type: "App";
};

export type WelcomePanel = {
    id: number;
    type: "Welcome";
    version?: string;
};

export type LoginPanel = {
    id: number;
    type: "Login";
};

export type MyCoursesPanel = {
    id: number;
    type: "MyCourses";
    courses?: Array<CourseData>;
    tmcDataPath?: string;
    tmcDataSize?: string;
    courseDeadlines: Record<number, string>;
};

export type CourseDetailsPanel = {
    id: number;
    type: "CourseDetails";
    courseId: number;
    course?: CourseData;
    offlineMode?: boolean;
    exerciseGroups?: Array<ExerciseGroup>;
    updateableExercises?: Array<number>;
    disabled?: boolean;
    exerciseStatuses?: Record<number, ExerciseStatus>;
};

export type SelectOrganizationPanel = {
    id: number;
    type: "SelectOrganization";
    // the result of the selection is sent back to this panel
    requestingPanel: TargetPanel<MyCoursesPanel>;
};

export type SelectCoursePanel = {
    id: number;
    type: "SelectCourse";
    organizationSlug: string;
    // the result of the selection is sent back to this panel
    requestingPanel: TargetPanel<MyCoursesPanel>;
};

export type ExerciseTestsPanel = {
    id: number;
    type: "ExerciseTests";
    course: TestCourse;
    exercise: TestExercise;
    exerciseUri: Uri;
    testRunId: number;
};

export type ExerciseSubmissionPanel = {
    id: number;
    type: "ExerciseSubmission";
    course: TestCourse;
    exercise: TestExercise;
};

export type InitializationErrorHelpPanel = {
    id: number;
    type: "InitializationErrorHelp";
};

/*
 * ======== messages to webview ========
 */

/**
 * For use with `webview.postMessage` in `TmcPanel`.
 * Handled by the Svelte app.
 */
export type ExtensionToWebview =
    | {
          type: "setPanel";
          target: TargetPanel<AppPanel>;
          panel: Panel;
      }
    | {
          type: "setWelcomeData";
          target: TargetPanel<WelcomePanel>;
          version: string;
      }
    | {
          type: "setMyCourses";
          target: TargetPanel<MyCoursesPanel>;
          courses: Array<CourseData>;
      }
    | {
          type: "setTmcDataPath";
          target: BroadcastPanel<MyCoursesPanel>;
          tmcDataPath: string;
      }
    | {
          type: "setNextCourseDeadline";
          target: TargetPanel<MyCoursesPanel>;
          courseId: number;
          deadline: string;
      }
    | {
          type: "setTmcDataSize";
          target: TargetPanel<MyCoursesPanel>;
          tmcDataSize: string;
      }
    | {
          type: "loginError";
          target: TargetPanel<LoginPanel>;
          error: string;
      }
    | {
          type: "setCourseData";
          target: TargetPanel<CourseDetailsPanel>;
          courseData: CourseData;
      }
    | {
          type: "setCourseGroups";
          target: TargetPanel<CourseDetailsPanel>;
          offlineMode: boolean;
          exerciseGroups: Array<ExerciseGroup>;
      }
    | {
          type: "setCourseDisabledStatus";
          target: BroadcastPanel<MyCoursesPanel | CourseDetailsPanel>;
          courseId: number;
          disabled: boolean;
      }
    | {
          type: "exerciseStatusChange";
          target: BroadcastPanel<CourseDetailsPanel>;
          exerciseId: number;
          status: ExerciseStatus;
      }
    | {
          type: "setUpdateables";
          target: BroadcastPanel<CourseDetailsPanel>;
          exerciseIds: Array<number>;
      }
    | {
          type: "setOrganizations";
          target: TargetPanel<SelectOrganizationPanel>;
          organizations: Array<Organization>;
      }
    | {
          type: "setTmcBackendUrl";
          target: TargetPanel<SelectOrganizationPanel | SelectCoursePanel>;
          tmcBackendUrl: string;
      }
    | {
          type: "setOrganization";
          target: TargetPanel<SelectCoursePanel>;
          organization: Organization;
      }
    | {
          type: "setSelectableCourses";
          target: TargetPanel<SelectCoursePanel>;
          courses: Array<Course>;
      }
    | {
          type: "testResults";
          target: TargetPanel<ExerciseTestsPanel>;
          testResults: TestResultData;
      }
    | {
          type: "testError";
          target: TargetPanel<ExerciseTestsPanel>;
          error: BaseError;
      }
    | {
          type: "pasteResult";
          target: TargetPanel<ExerciseTestsPanel | ExerciseSubmissionPanel>;
          pasteLink: string;
      }
    | {
          type: "pasteError";
          target: TargetPanel<ExerciseTestsPanel | ExerciseSubmissionPanel>;
          error: string;
      }
    | {
          type: "submissionStatusUrl";
          target: TargetPanel<ExerciseSubmissionPanel>;
          url: string;
      }
    | {
          type: "submissionStatusUpdate";
          target: TargetPanel<ExerciseSubmissionPanel>;
          progressPercent: number;
          message?: string;
      }
    | {
          type: "submissionResult";
          target: TargetPanel<ExerciseSubmissionPanel>;
          result: SubmissionFinished;
          questions: Array<FeedbackQuestion>;
      }
    | {
          type: "submissionStatusError";
          target: TargetPanel<ExerciseSubmissionPanel>;
          error: Error;
      }
    | {
          type: "setNewExercises";
          target: BroadcastPanel<MyCoursesPanel>;
          courseId: number;
          exerciseIds: Array<number>;
      }
    | {
          type: "willNotRunTestsForExam";
          target: TargetPanel<ExerciseTestsPanel>;
      }
    | {
          type: "initializationErrors";
          target: TargetPanel<InitializationErrorHelpPanel>;
          cliFolder: string;
          initializationErrors: {
              tmc: { error: string; stack: string } | null;
              userData: { error: string; stack: string } | null;
              workspaceManager: { error: string; stack: string } | null;
              exerciseDecorationProvider: { error: string; stack: string } | null;
              resources: { error: string; stack: string } | null;
          };
      }
    // the last variant exists just to make TypeScript think that every panel type has
    // at least two different message types, which makes TS treat them differently than if
    // they only had one...
    | {
          type: never;
          target: TargetPanel<never>;
      };

// helper type for messages from the extension to a specific panel
export type TargetedExtensionToWebview<T extends PanelType> = Targeted<ExtensionToWebview, T>;

// helper type for messages from the extension to a specific panel type
export type BroadcastExtensionToWebview<T extends PanelType> = Broadcast<ExtensionToWebview, T>;

/*
 * ======== from webview ========
 */

/**
 * For use with `vscode.postMessage` in the Svelte app.
 * Handled by the extension host in `TmcPanel`.
 */
export type WebviewToExtension =
    | {
          type: "requestCourseDetailsData";
          sourcePanel: CourseDetailsPanel;
      }
    | {
          type: "requestExerciseSubmissionData";
          sourcePanel: ExerciseSubmissionPanel;
      }
    | {
          type: "requestExerciseTestsData";
          sourcePanel: ExerciseTestsPanel;
      }
    | {
          type: "requestLoginData";
          sourcePanel: LoginPanel;
      }
    | {
          type: "requestMyCoursesData";
          sourcePanel: MyCoursesPanel;
      }
    | {
          type: "requestSelectCourseData";
          sourcePanel: SelectCoursePanel;
      }
    | {
          type: "requestSelectOrganizationData";
          sourcePanel: SelectOrganizationPanel;
      }
    | {
          type: "requestWelcomeData";
          sourcePanel: WelcomePanel;
      }
    | {
          type: "login";
          sourcePanel: LoginPanel;
          username: string;
          password: string;
      }
    | {
          type: "selectOrganization";
          sourcePanel: TargetPanel<MyCoursesPanel>;
      }
    | {
          type: "removeCourse";
          id: number;
      }
    | {
          type: "openCourseWorkspace";
          courseName: string;
      }
    | {
          type: "downloadExercises";
          ids: Array<number>;
          courseName: string;
          organizationSlug: string;
          courseId: number;
          mode: "download" | "update";
      }
    | {
          type: "clearNewExercises";
          courseId: number;
      }
    | {
          type: "changeTmcDataPath";
      }
    | {
          type: "openCourseDetails";
          courseId: number;
      }
    | {
          type: "openMyCourses";
      }
    | {
          type: "refreshCourseDetails";
          id: number;
          useCache: boolean;
      }
    | {
          type: "openExercises";
          ids: Array<number>;
          courseName: string;
      }
    | {
          type: "closeExercises";
          ids: Array<number>;
          courseName: string;
      }
    | {
          type: "refreshCourseDetails";
          id: number;
          useCache: boolean;
      }
    | {
          type: "selectCourse";
          sourcePanel: TargetPanel<MyCoursesPanel>;
          slug: string;
      }
    | {
          type: "addCourse";
          organizationSlug: string;
          courseId: number;
          requestingPanel: TargetPanel<MyCoursesPanel>;
      }
    | {
          type: "relayToWebview";
          // the message type is handled by the webview
          message: unknown;
      }
    | {
          type: "closeSidePanel";
      }
    | {
          type: "cancelTests";
          testRunId: number;
      }
    | {
          type: "submitExercise";
          course: TestCourse;
          exercise: TestExercise;
          exerciseUri: Uri;
      }
    | {
          type: "pasteExercise";
          course: TestCourse;
          exercise: TestExercise;
          requestingPanel: TargetPanel<ExerciseTestsPanel | ExerciseSubmissionPanel>;
      }
    | {
          type: "openLinkInBrowser";
          url: string;
      }
    | {
          type: "requestInitializationErrors";
          sourcePanel: InitializationErrorHelpPanel;
      };

/*
 * ======== additional types ========
 */

export type CourseData = {
    id: number;
    name: string;
    title: string;
    description: string;
    organization: string;
    awardedPoints: number;
    availablePoints: number;
    exercises: Array<NewExercise>;
    newExercises: Array<number>;
    disabled: boolean;
    materialUrl: string | null;
    perhapsExamMode: boolean;
};

export type NewExercise = {
    id: number;
};

export type ExerciseGroup = {
    name: string;
    exercises: Array<Exercise>;
    nextDeadlineString: string;
};

export type Exercise = {
    id: number;
    name: string;
    isHard: boolean;
    hardDeadlineString: string;
    softDeadlineString: string;
    passed: boolean;
};

export type ExerciseStatus =
    | "closed"
    | "downloading"
    | "downloadFailed"
    | "expired"
    | "missing"
    | "new"
    | "opened";

export type TestExercise = {
    id: number;
    availablePoints: number;
    awardedPoints: number;
    /// Equivalent to exercise slug
    name: string;
    deadline: string | null;
    passed: boolean;
    softDeadline: string | null;
};

export type TestResultData = {
    testResult: RunResult;
    id: number;
    courseSlug: string;
    exerciseName: string;
    tmcLogs: {
        stdout?: string;
        stderr?: string;
    };
    pasteLink?: string;
    disabled?: boolean;
    styleValidationResult?: StyleValidationResult | null;
};

export type TestCourse = {
    id: number;
    name: string;
    title: string;
    description: string;
    organization: string;
    availablePoints: number;
    awardedPoints: number;
    perhapsExamMode: boolean;
    newExercises: number[];
    notifyAfter: number;
    disabled: boolean;
    materialUrl: string | null;
};

export type FeedbackQuestion = {
    id: number;
    kind: string;
    lower?: number;
    upper?: number;
    question: string;
};

/*
 * ======== helpers ========
 */

// excludes from the message union all variants where the
// target type doesn't have the panel type
// works...somehow
export type Targeted<M, T extends PanelType> = Exclude<
    M,
    { target: { type: Exclude<PanelType, T> } }
>;

export type Broadcast<M, T extends PanelType> = Omit<Targeted<M, T>, "target">;

export function assertUnreachable(x: never): never {
    throw new Error(`Unreachable ${JSON.stringify(x, null, 2)}`);
}

/*
 * ======== errors ========
 */
export class BaseError extends Error {
    public readonly name: string = "Base Error";
    public details?: string;
    public cause?: NodeJS.ErrnoException | string;
    public stack?: string;

    // possible fields from ErrnoException
    public errno?: number;
    public code?: string;
    public path?: string;
    public syscall?: string;

    constructor(err: unknown);
    constructor(err: Error, details?: string);
    constructor(message?: string, details?: string);

    constructor(err: unknown, details?: string) {
        let message = "";
        let stack = "";
        let cause: NodeJS.ErrnoException | string = "";

        let errno: number | undefined = undefined;
        let code: string | undefined = undefined;
        let path: string | undefined = undefined;
        let syscall: string | undefined = undefined;

        // simple check first...
        if (typeof err === "string") {
            message = err;
        } else if (util.types.isNativeError(err)) {
            // deal with regular error stuff first
            message = err.message;
            if (err.stack) {
                stack = err.stack;
            }

            // also check for special NodeJS error
            if (createIs<NodeJS.ErrnoException>()(err)) {
                // nodejs error with error code
                errno = err.errno;
                code = err.code;
                path = err.path;
                syscall = err.syscall;
            }

            if (err.cause) {
                // same checks for cause
                if (
                    util.types.isNativeError(err.cause) &&
                    createIs<NodeJS.ErrnoException>()(err.cause)
                ) {
                    cause = err.cause;
                } else {
                    cause = err.cause.toString();
                }
            }
        } else {
            // it's expected that this function is only called with
            // strings or error objects. but since errors are often "unknown"
            // in catch statements etc., this function accepts unknown types
            // and thus we'll handle them here just in case
            message = `Unexpected error ${err} (${typeof err})`;
        }

        super(message);
        this.details = details;
        if (stack) {
            this.stack = stack;
        }
        if (cause) {
            this.cause = cause;
        }

        // errno fields
        this.errno = errno;
        this.code = code;
        this.path = path;
        this.syscall = syscall;
    }

    public toString(): string {
        let errorMessage = "";
        if (this.errno) {
            errorMessage += `[${this.errno}] `;
        }
        if (this.code) {
            errorMessage += `(${this.code}) `;
        }
        if (this.syscall) {
            errorMessage += `\`${this.syscall}\` `;
        }
        if (this.path) {
            errorMessage += `@${this.path} `;
        }
        errorMessage += `${this.name}: ${this.message}.`;
        if (this.details) {
            errorMessage += ` ${this.details}.`;
        }
        if (this.cause) {
            errorMessage += ` Caused by: ${this.cause}.`;
        }
        return errorMessage;
    }
}
