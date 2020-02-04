import TMC from "../../api/tmc";
import Storage from "../../config/storage";
import UI from "../ui";

export type ActionContext = {
    tmc: TMC;
    storage: Storage;
    ui: UI;
};

export type HandlerContext = {
    tmc: TMC;
    storage: Storage;
    ui: UI;
};
