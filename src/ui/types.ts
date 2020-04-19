import TMC from "../api/tmc";
import Storage from "../config/storage";
import UI from "./ui";

export type HandlerContext = {
    tmc: TMC;
    storage: Storage;
    ui: UI;
    visibilityGroups: VisibilityGroups;
};

export type VisibilityGroups = {
    LOGGED_IN: VisibilityGroup;
    WORKSPACE_OPEN: VisibilityGroup;
};

export type VisibilityGroup = {
    _id: string;
    not: VisibilityGroupNegated;
};

export type VisibilityGroupNegated = {
    _id: string;
};

export type TemplateName =
    | "course-details"
    | "course"
    | "download-exercises"
    | "downloading-exercises"
    | "error"
    | "index"
    | "loading"
    | "login"
    | "organization"
    | "running-tests"
    | "settings"
    | "submission-result"
    | "submission-status"
    | "test-result";
