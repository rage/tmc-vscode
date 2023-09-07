export type State = {
    panel: Panel;
};

/**
 * Type representing a panel that is rendered by the webview.
 *
 * Each panel may have these fields:
 * - `args`: arguments that need to be known in order to get the `data`, e.g. a course id
 * - `data`: data that needs to be fetched to render the panel, e.g. a course name
 */
export type Panel =
    | {
          type: "Welcome";
      }
    | {
          type: "Login";
      }
    | {
          type: "MyCourses";
      }
    | {
          type: "CourseDetails";
          courseId: number;
      }
    | {
          type: "Initial";
      };

/**
 * For use with `webview.postMessage` in `TmcPanel`.
 * Handled by the Svelte app.
 */
export type MessageToWebview =
    | {
          type: "setPanel";
          panel: Panel;
      }
    | {
          type: "setWelcomeData";
          version: string;
          exerciseDecorations: string;
      }
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
      }
    | {
          type: "loginError";
          error: string;
      }
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
          courseId: number;
          exerciseIds: Array<number>;
      };

/**
 * For use with `vscode.postMessage` in the Svelte app.
 * Handled by the extension host in `TmcPanel`.
 */
export type MessageFromWebview =
    | {
          type: "login";
          username: string;
          password: string;
      }
    | {
          type: "addCourse";
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
