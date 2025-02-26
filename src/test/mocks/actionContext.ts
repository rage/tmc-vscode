import { Mock } from "typemoq";

import { ActionContext } from "../../actions/types";
import Dialog from "../../api/dialog";
import ExerciseDecorationProvider from "../../api/exerciseDecorationProvider";
import TMC from "../../api/langs";
import WorkspaceManager from "../../api/workspaceManager";
import Resouces from "../../config/resources";
import Settings from "../../config/settings";
import { UserData } from "../../config/userdata";
import { VisibilityGroups } from "../../ui/types";
import UI from "../../ui/ui";

export function createMockActionContext(): ActionContext {
    return {
        dialog: Mock.ofType<Dialog>().object,
        exerciseDecorationProvider: Mock.ofType<ExerciseDecorationProvider>().object,
        resources: Mock.ofType<Resouces>().object,
        settings: Mock.ofType<Settings>().object,
        tmc: Mock.ofType<TMC>().object,
        ui: Mock.ofType<UI>().object,
        userData: Mock.ofType<UserData>().object,
        workspaceManager: Mock.ofType<WorkspaceManager>().object,
        visibilityGroups: Mock.ofType<VisibilityGroups>().object,
    };
}
