import { ActionContext } from "../../actions/types";
import Dialog from "../../api/dialog";
import ExerciseDecorationProvider from "../../api/exerciseDecorationProvider";
import TMC from "../../api/tmc";
import WorkspaceManager from "../../api/workspaceManager";
import Resouces from "../../config/resources";
import Settings from "../../config/settings";
import { UserData } from "../../config/userdata";
import { VisibilityGroups } from "../../ui/types";
import UI from "../../ui/ui";
import { Result } from "ts-results";
import { Mock } from "typemoq";

export function createMockActionContext(): ActionContext {
    return {
        dialog: Mock.ofType<Dialog>().object,
        exerciseDecorationProvider: Mock.ofType<Result<ExerciseDecorationProvider, Error>>().object,
        resources: Mock.ofType<Result<Resouces, Error>>().object,
        settings: Mock.ofType<Settings>().object,
        tmc: Mock.ofType<Result<TMC, Error>>().object,
        ui: Mock.ofType<UI>().object,
        userData: Mock.ofType<Result<UserData, Error>>().object,
        workspaceManager: Mock.ofType<Result<WorkspaceManager, Error>>().object,
        visibilityGroups: Mock.ofType<VisibilityGroups>().object,
    };
}
