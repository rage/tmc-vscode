import type { Result } from "ts-results"
import { Mock } from "typemoq"

import type { ActionContext } from "../../actions/types"
import type Dialog from "../../api/dialog"
import type ExerciseDecorationProvider from "../../api/exerciseDecorationProvider"
import type Langs from "../../api/langs"
import type WorkspaceManager from "../../api/workspaceManager"
import type Resouces from "../../config/resources"
import type Settings from "../../config/settings"
import type { UserData } from "../../config/userdata"
import type { VisibilityGroups } from "../../ui/types"
import type UI from "../../ui/ui"

export function createMockActionContext(): ActionContext {
  return {
    dialog: Mock.ofType<Dialog>().object,
    exerciseDecorationProvider: Mock.ofType<Result<ExerciseDecorationProvider, Error>>().object,
    resources: Mock.ofType<Result<Resouces, Error>>().object,
    settings: Mock.ofType<Settings>().object,
    langs: Mock.ofType<Result<Langs, Error>>().object,
    ui: Mock.ofType<UI>().object,
    userData: Mock.ofType<Result<UserData, Error>>().object,
    workspaceManager: Mock.ofType<Result<WorkspaceManager, Error>>().object,
    visibilityGroups: Mock.ofType<VisibilityGroups>().object,
  }
}
