import type { Result } from "ts-results"
import { Ok } from "ts-results"
import { vi } from "vitest"

import type { ActionContext } from "../../actions/types"
import type { AuthState } from "../../api/authState"
import type Dialog from "../../api/dialog"
import type ExerciseDecorationProvider from "../../api/exerciseDecorationProvider"
import type Langs from "../../api/langs"
import type WorkspaceManager from "../../api/workspaceManager"
import type Resources from "../../config/resources"
import type Settings from "../../config/settings"
import type { UserData } from "../../config/userdata"
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
  /** Which backends hold a session; both do unless said otherwise. */
  authenticated?: { tmc?: boolean; mooc?: boolean }
}

/** An auth state stuck at a fixed login status, with no CLI behind it. */
export function createMockAuthState(
  authenticated: { tmc?: boolean; mooc?: boolean } = {},
): AuthState {
  const tmc = authenticated.tmc ?? true
  const mooc = authenticated.mooc ?? true
  return {
    tmc,
    mooc,
    loggedIn: tmc || mooc,
    refresh: vi.fn(async () => ({ tmc: Ok(tmc), mooc: Ok(mooc) })),
    set: vi.fn(async () => {}),
    clear: vi.fn(async () => {}),
    subscribe: vi.fn(),
  }
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
    authState: createMockAuthState(options.authenticated),
    dialog: autoMock<Dialog>(),
    exerciseDecorationProvider: service<ExerciseDecorationProvider>("exerciseDecorationProvider"),
    resources: service<Resources>("resources"),
    settings: autoMock<Settings>(),
    langs: service<Langs>("langs"),
    ui: autoMock<UI>(),
    userData: service<UserData>("userData"),
    workspaceManager: service<WorkspaceManager>("workspaceManager"),
  }
}
