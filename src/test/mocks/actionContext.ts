import { Ok } from "ts-results"
import { vi } from "vitest"

import type { ActionContext, ReadyActionContext, ReadyStartup } from "../../actions/types"
import type { AuthState } from "../../api/authState"
import type Dialog from "../../api/dialog"
import type ExerciseDecorationProvider from "../../api/exerciseDecorationProvider"
import type Langs from "../../api/langs"
import type WorkspaceManager from "../../api/workspaceManager"
import type Resources from "../../config/resources"
import type Settings from "../../config/settings"
import type { UserData } from "../../config/userdata"
import type UI from "../../ui/ui"
import { autoMock } from "../support/mock"

export interface MockActionContextOptions {
  /** Which backends hold a session; both do unless said otherwise. */
  authenticated?: { tmc?: boolean; mooc?: boolean }
  /** Services the test drives itself; the rest stay loose auto-mocks. */
  startup?: Partial<Omit<ReadyStartup, "kind">>
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
 * A loose baseline action context whose activation succeeded.
 *
 * Every service is an auto-mock whose property access is truthy; pass the ones the test
 * drives in `startup`. Use {@link createDegradedContext} for the failed-activation arm.
 */
export function createMockActionContext(
  options: MockActionContextOptions = {},
): ReadyActionContext {
  return {
    authState: createMockAuthState(options.authenticated),
    dialog: autoMock<Dialog>(),
    settings: autoMock<Settings>(),
    ui: autoMock<UI>(),
    startup: {
      kind: "ready",
      exerciseDecorationProvider: autoMock<ExerciseDecorationProvider>(),
      langs: autoMock<Langs>(),
      resources: autoMock<Resources>(),
      userData: autoMock<UserData>(),
      workspaceManager: autoMock<WorkspaceManager>(),
      ...options.startup,
    },
  }
}

/** A context whose activation failed, which is the only way to reach a degraded arm. */
export function createDegradedContext(
  options: Omit<MockActionContextOptions, "startup"> & {
    failures?: Record<string, Error>
  } = {},
): ActionContext {
  const { failures, ...shared } = options
  return {
    ...createMockActionContext(shared),
    startup: {
      kind: "degraded",
      failures: failures ?? { langs: new Error("langs failed to initialize") },
    },
  }
}
