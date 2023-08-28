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
          data: { version: string; exerciseDecorations: string };
      }
    | {
          type: "Login";
      }
    | {
          type: "MyCourses";
          data: {
              courses: Array<CourseData>;
              tmcDataPath: string;
              tmcDataSize: string;
          };
      }
    | {
          type: "CourseDetails";
          args: {
              courseId: number;
          };
          data: {
              data: any;
          };
      }
    | {
          type: "Initial";
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
};

export type NewExercise = {
    id: number;
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
          type: "loginError";
          error: string;
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
          name: string;
      }
    | {
          type: "downloadExercises";
          ids: Array<number>;
          courseName: string;
          organizationSlug: string;
          courseId: number;
          mode: "download";
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
      };
