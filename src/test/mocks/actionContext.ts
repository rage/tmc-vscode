import { Ok } from "ts-results"
import { vi } from "vitest"

import type { ActionContext, ReadyActionContext, ReadyStartup } from "../../actions/types"
import type { AiUseGate } from "../../api/aiUseGate"
import type { AuthState } from "../../api/authState"
import type { CourseWorkspaceSwitches } from "../../api/courseWorkspaceSwitches"
import type Dialog from "../../api/dialog"
import type ExerciseDecorationProvider from "../../api/exerciseDecorationProvider"
import type Langs from "../../api/langs"
import type WorkspaceManager from "../../api/workspaceManager"
import type { WorkspaceTrustGate } from "../../api/workspaceTrustGate"
import type Resources from "../../config/resources"
import type Settings from "../../config/settings"
import type { UserData } from "../../config/userdata"
import type CoursesTree from "../../ui/treeview/treeview"
import { autoMock } from "../support/mock"
import { createDialogMock } from "./dialog"

export interface MockActionContextOptions {
  /** Whether the user has a session; they do unless said otherwise. */
  loggedIn?: boolean
  /** Services the test drives itself; the rest stay loose auto-mocks. */
  startup?: Partial<Omit<ReadyStartup, "kind">>
}

/** An auth state stuck at a fixed login status, with no CLI behind it. */
export function createMockAuthState(loggedIn = true): AuthState {
  return {
    loggedIn,
    refresh: vi.fn(async () => Ok(loggedIn)),
    set: vi.fn(async () => {}),
    subscribe: vi.fn(),
    sessionRefusalsReported: new Set(),
  }
}

// A bare auto-mock would return a stub from `progressNotification`, silently skipping
// every task run under a progress bar.
function dialogRunningProgressTasks(): Dialog {
  const fallback = autoMock<Dialog>()
  const { progressNotification } = createDialogMock()[0]
  return new Proxy(fallback as object, {
    get: (target, prop) =>
      prop === "progressNotification" ? progressNotification : Reflect.get(target, prop),
  }) as Dialog
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
    authState: createMockAuthState(options.loggedIn),
    dialog: dialogRunningProgressTasks(),
    settings: autoMock<Settings>(),
    coursesTree: autoMock<CoursesTree>(),
    startup: {
      kind: "ready",
      // Refuses nothing: `refusal` resolves to `undefined`.
      aiUseGate: autoMock<AiUseGate>(),
      courseWorkspaceSwitches: autoMock<CourseWorkspaceSwitches>(),
      exerciseDecorationProvider: autoMock<ExerciseDecorationProvider>(),
      langs: autoMock<Langs>(),
      resources: autoMock<Resources>(),
      // Refuses nothing: `refusal` returns `undefined`.
      trustGate: autoMock<WorkspaceTrustGate>(),
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
