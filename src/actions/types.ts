import type { AuthState } from "../api/authState"
import type Dialog from "../api/dialog"
import type ExerciseDecorationProvider from "../api/exerciseDecorationProvider"
import type Langs from "../api/langs"
import type WorkspaceManager from "../api/workspaceManager"
import type Resources from "../config/resources"
import type Settings from "../config/settings"
import type { UserData } from "../config/userdata"
import type UI from "../ui/ui"

/** The services an activation builds, once all of them have succeeded. */
export interface ReadyStartup {
  kind: "ready"
  exerciseDecorationProvider: ExerciseDecorationProvider
  langs: Langs
  resources: Resources
  userData: UserData
  workspaceManager: WorkspaceManager
}

/** The errors behind a failed activation, keyed by the service that failed. */
export interface DegradedStartup {
  kind: "degraded"
  failures: Record<string, Error>
}

/**
 * What an activation managed to build.
 *
 * Deliberately binary: a caller that needs one of these services needs the rest, and the
 * partial combinations `extension.ts` can produce follow from its construction order
 * rather than from anything a caller could act on.
 */
export type Startup = ReadyStartup | DegradedStartup

export interface ActionContext {
  authState: AuthState
  dialog: Dialog
  settings: Settings
  startup: Startup
  ui: UI
}

/** A context whose services are all available, and the argument most actions want. */
export interface ReadyActionContext extends ActionContext {
  startup: ReadyStartup
}

/**
 * Whether the activation behind this context built everything.
 *
 * Narrows the context itself, not just its {@link Startup}, so a caller can hand it
 * straight to something that takes a {@link ReadyActionContext}.
 */
export function isReady(context: ActionContext): context is ReadyActionContext {
  return context.startup.kind === "ready"
}
