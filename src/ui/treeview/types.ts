import TMC from "../../api/tmc";
import Storage from "../../config/storage";
import UI from "../ui";
import { VisibilityGroup } from "./visibility";

export type ActionContext = {
    tmc: TMC;
    storage: Storage;
    ui: UI;
    visibilityGroups: VisibilityGroups;
};

export type HandlerContext = {
    tmc: TMC;
    storage: Storage;
    ui: UI;
    visibilityGroups: VisibilityGroups;
};

export type VisibilityGroups = {
    LOGGED_IN: VisibilityGroup;
    ORGANIZATION_CHOSEN: VisibilityGroup;
    COURSE_CHOSEN: VisibilityGroup;
};
