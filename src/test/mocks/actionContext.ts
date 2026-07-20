import type { Result } from "ts-results"

import type { ActionContext } from "../../actions/types"
import type Dialog from "../../api/dialog"
import type ExerciseDecorationProvider from "../../api/exerciseDecorationProvider"
import type Langs from "../../api/langs"
import type WorkspaceManager from "../../api/workspaceManager"
import type Resources from "../../config/resources"
import type Settings from "../../config/settings"
import type { UserData } from "../../config/userdata"
import type { VisibilityGroups } from "../../ui/types"
import type UI from "../../ui/ui"
import { autoMock } from "../support/mock"

/**
 * A loose baseline action context. Tests spread this and override the
 * specific fields (langs, userData, workspaceManager, …) they exercise; every
 * other field — including the `Result`-typed ones — is a loose auto-mock whose
 * property access is truthy.
 */
export function createMockActionContext(): ActionContext {
  return {
    dialog: autoMock<Dialog>(),
    exerciseDecorationProvider: autoMock<Result<ExerciseDecorationProvider, Error>>(),
    resources: autoMock<Result<Resources, Error>>(),
    settings: autoMock<Settings>(),
    langs: autoMock<Result<Langs, Error>>(),
    ui: autoMock<UI>(),
    userData: autoMock<Result<UserData, Error>>(),
    workspaceManager: autoMock<Result<WorkspaceManager, Error>>(),
    visibilityGroups: autoMock<VisibilityGroups>(),
  }
}
