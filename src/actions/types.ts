import ExerciseManager from "../api/exerciseManager";
import TMC from "../api/tmc";
import Resources from "../config/resources";
import UI from "../ui/ui";

export type ActionContext = {
    tmc: TMC;
    ui: UI;
    resources: Resources;
    exerciseManager: ExerciseManager;
};
