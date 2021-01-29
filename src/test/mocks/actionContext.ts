import { Mock } from "typemoq";

import { ActionContext } from "../../actions/types";
import TMC from "../../api/tmc";
import WorkspaceManager from "../../api/workspaceManager";
import Resouces from "../../config/resources";
import Settings from "../../config/settings";
import { UserData } from "../../config/userdata";
import TemporaryWebviewProvider from "../../ui/temporaryWebviewProvider";
import { VisibilityGroups } from "../../ui/types";
import UI from "../../ui/ui";

export function createMockActionContext(): ActionContext {
    return {
        resources: Mock.ofType<Resouces>().object,
        settings: Mock.ofType<Settings>().object,
        temporaryWebviewProvider: Mock.ofType<TemporaryWebviewProvider>().object,
        tmc: Mock.ofType<TMC>().object,
        ui: Mock.ofType<UI>().object,
        userData: Mock.ofType<UserData>().object,
        workspaceManager: Mock.ofType<WorkspaceManager>().object,
        visibilityGroups: Mock.ofType<VisibilityGroups>().object,
    };
}
