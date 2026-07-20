import type { Result } from "ts-results"

import type Dialog from "../api/dialog"
import type ExerciseDecorationProvider from "../api/exerciseDecorationProvider"
import type Langs from "../api/langs"
import type WorkspaceManager from "../api/workspaceManager"
import type Resources from "../config/resources"
import type Settings from "../config/settings"
import type { UserData } from "../config/userdata"
import type { VisibilityGroups } from "../ui/types"
import type UI from "../ui/ui"

// fields may be undefined if something went wrong during initialization
export interface ActionContext {
  dialog: Dialog
  exerciseDecorationProvider: Result<ExerciseDecorationProvider, Error>
  resources: Result<Resources, Error>
  settings: Settings
  langs: Result<Langs, Error>
  ui: UI
  userData: Result<UserData, Error>
  workspaceManager: Result<WorkspaceManager, Error>
  visibilityGroups: VisibilityGroups
}

export interface FeedbackQuestion {
  id: number
  kind: string
  lower?: number
  upper?: number
  question: string
}
