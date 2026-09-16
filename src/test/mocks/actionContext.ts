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
import { autoMock, errResult, okResult } from "../support/mock"

type ServiceOutcome = "ok" | "err"

/** How each `Result`-typed service initialized; anything omitted succeeded. */
export interface MockActionContextOptions {
  exerciseDecorationProvider?: ServiceOutcome
  langs?: ServiceOutcome
  resources?: ServiceOutcome
  userData?: ServiceOutcome
  workspaceManager?: ServiceOutcome
}

/**
 * A loose baseline action context. Tests spread this and override the
 * specific fields (langs, userData, workspaceManager, …) they exercise; every
 * other field is a loose auto-mock whose property access is truthy.
 *
 * Pass `{ langs: "err" }` (and so on) to degrade a service, which is the only
 * way to reach an action's initialization-failure arm.
 */
export function createMockActionContext(options: MockActionContextOptions = {}): ActionContext {
  const service = <T>(name: keyof MockActionContextOptions): Result<T, Error> =>
    options[name] === "err" ? errResult<T>(`${name} failed to initialize`) : okResult<T>()

  return {
    dialog: autoMock<Dialog>(),
    exerciseDecorationProvider: service<ExerciseDecorationProvider>("exerciseDecorationProvider"),
    resources: service<Resources>("resources"),
    settings: autoMock<Settings>(),
    langs: service<Langs>("langs"),
    ui: autoMock<UI>(),
    userData: service<UserData>("userData"),
    workspaceManager: service<WorkspaceManager>("workspaceManager"),
    visibilityGroups: autoMock<VisibilityGroups>(),
  }
}
