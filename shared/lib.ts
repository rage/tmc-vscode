/*
 * ======== state ========
 */

export type State = {
    panel: Panel;
};

/*
 * ======== panels ========
 */

/**
 * Type representing a panel that is rendered by the webview.
 */
export type Panel =
    | AppPanel
    | WelcomePanel
    | LoginPanel
    | MyCoursesPanel
    | CourseDetailsPanel
    | SelectOrganizationPanel
    | SelectCoursePanel;

export type PanelType = Panel["type"];

export type SpecificPanel<T extends PanelType> = Panel & { type: T };

export type AppPanel = {
    id: number;
    type: "App";
};

export type WelcomePanel = {
    id: number;
    type: "Welcome";
};

export type LoginPanel = {
    id: number;
    type: "Login";
};

export type MyCoursesPanel = {
    id: number;
    type: "MyCourses";
};

export type CourseDetailsPanel = {
    id: number;
    type: "CourseDetails";
    courseId: number;
};

export type SelectOrganizationPanel = {
    id: number;
    type: "SelectOrganization";
    requestingPanel: Panel;
};

export type SelectCoursePanel = {
    id: number;
    type: "SelectCourse";
    organizationSlug: string;
    requestingPanel: Panel;
};

/*
 * ======== to webview ========
 */

/**
 * For use with `webview.postMessage` in `TmcPanel`.
 * Handled by the Svelte app.
 * The `source` is used to differentiate between different kinds of message events.
 */
export type ExtensionToWebview =
    | {
          source: "extensionHost";
          panelId: number;
          panelType: AppPanel["type"];
          message: ExtensionToApp;
      }
    | {
          source: "extensionHost";
          panelId: number;
          panelType: WelcomePanel["type"];
          message: ExtensionToWelcome;
      }
    | {
          source: "extensionHost";
          panelId: number;
          panelType: LoginPanel["type"];
          message: ExtensionToLogin;
      }
    | {
          source: "extensionHost";
          panelId: number;
          panelType: MyCoursesPanel["type"];
          message: ExtensionToMyCourses;
      }
    | {
          source: "extensionHost";
          panelId: number;
          panelType: CourseDetailsPanel["type"];
          message: ExtensionToCourseDetails;
      }
    | {
          source: "extensionHost";
          panelId: number;
          panelType: SelectOrganizationPanel["type"];
          message: ExtensionToSelectOrganization;
      }
    | {
          source: "extensionHost";
          panelId: number;
          panelType: SelectCoursePanel["type"];
          message: ExtensionToSelectCourse;
      };

export type TargetedExtensionToWebview<T extends PanelType> = (ExtensionToWebview & {
    panelType: T;
})["message"];

export type ExtensionToApp =
    | {
          type: "setPanel";
          panel: Panel;
      }
    | {
          // unused variant to enable use of assertUnreachable,
          // which cannot be used with a non-union type
          type: never;
      };
export type ExtensionToWelcome =
    | {
          type: "setWelcomeData";
          version: string;
          exerciseDecorations: string;
      }
    | {
          // unused variant to enable use of assertUnreachable,
          // which cannot be used with a non-union type
          type: never;
      };

export type ExtensionToLogin =
    | {
          type: "loginError";
          error: string;
      }
    | {
          // unused variant to enable use of assertUnreachable,
          // which cannot be used with a non-union type
          type: never;
      };

export type ExtensionToMyCourses =
    | {
          type: "setCourses";
          courses: Array<CourseData>;
      }
    | {
          type: "setTmcDataPath";
          tmcDataPath: string;
      }
    | {
          type: "setTmcDataSize";
          tmcDataSize: string;
      };

export type ExtensionToCourseDetails =
    | {
          type: "setCourseData";
          courseData: CourseData;
      }
    | {
          type: "setCourseGroups";
          offlineMode: boolean;
          exerciseGroups: Array<ExerciseGroup>;
      }
    | {
          type: "setCourseDisabledStatus";
          courseId: number;
          disabled: boolean;
      }
    | {
          type: "exerciseStatusChange";
          exerciseId: number;
          status: ExerciseStatus;
      }
    | {
          type: "setUpdateables";
          exerciseIds: Array<number>;
      };

export type ExtensionToSelectOrganization =
    | {
          type: "setOrganizations";
          organizations: Array<Organization>;
      }
    | {
          type: "setTmcBackendUrl";
          tmcBackendUrl: string;
      };

export type ExtensionToSelectCourse =
    | {
          type: "setOrganization";
          organization: Organization;
      }
    | {
          type: "setCourses";
          courses: Array<Course>;
      }
    | {
          type: "setTmcBackendUrl";
          tmcBackendUrl: string;
      };

/*
 * ======== from webview ========
 */

/**
 * For use with `vscode.postMessage` in the Svelte app.
 * Handled by the extension host in `TmcPanel`.
 */
export type WebviewToExtension =
    | {
          type: "ready";
          panel: Panel;
      }
    | {
          type: "login";
          sourcePanel: LoginPanel;
          username: string;
          password: string;
      }
    | {
          type: "selectOrganization";
          sourcePanel: Panel;
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
          type: "openSelected";
          ids: Array<number>;
          courseName: string;
      }
    | {
          type: "closeSelected";
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
          sourcePanel: Panel;
          slug: string;
      }
    | {
          type: "addCourse";
          organizationSlug: string;
          courseId: number;
      }
    | {
          type: "relayToWebview";
          // the message type is handled by the webview
          message: unknown;
      }
    | {
          type: "closeSidePanel";
      };

/*
 * ======== additional types ========
 */

export type Course = {
    id: number;
    name: string;
    title: string;
    description: string | null;
    details_url: string;
    unlock_url: string;
    reviews_url: string;
    comet_url: string;
    spyware_urls: string[];
};

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

export type Organization = {
    slug: string;
    name: string;
    information: string;
    logo_path: string;
    pinned: boolean;
};

/*
 * ======== helpers ========
 */

export function assertUnreachable(x: never): never {
    throw new Error(`Unreachable ${JSON.stringify(x, null, 2)}`);
}
