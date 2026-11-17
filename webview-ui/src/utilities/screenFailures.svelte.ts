import type {
  CourseDetailsPanel,
  ExerciseSubmissionPanel,
  ScreenFailure,
} from "../../../shared/lib"
import { addMessageListener } from "./script"
import { uiState } from "./uiState.svelte"

// Bounded: the host resends only its latest few, so an older serial never comes back.
const DISMISSALS_KEPT = 20

/**
 * The failures of what a screen started, newest last, each until dismissed, replaced by a later
 * failure of its operation, or cleared by the host.
 */
export interface ScreenFailureList {
  readonly current: readonly ScreenFailure[]
  dismiss: (serial: number) => void
  dismissAll: () => void
}

/**
 * Collects the failures the host reports for `panel`. The host resends them to a reloaded
 * document, before the screen has its data, which leaves out the ones dismissed before.
 *
 * Must be called during component initialization, like `addMessageListener`.
 */
export function listenForFailures(
  panel: CourseDetailsPanel | ExerciseSubmissionPanel,
): ScreenFailureList {
  let failures = $state.raw<ScreenFailure[]>([])
  const dismissed = uiState<number[]>("dismissedFailures", [])
  const dismissWhere = (isDismissed: (failure: ScreenFailure) => boolean): void => {
    const serials = failures.filter((failure) => isDismissed(failure)).map(({ serial }) => serial)
    if (serials.length === 0) {
      return
    }
    failures = failures.filter((failure) => !serials.includes(failure.serial))
    dismissed.current = [...dismissed.current, ...serials].slice(-DISMISSALS_KEPT)
  }
  addMessageListener(panel, (message) => {
    if (message.type === "failuresCleared") {
      const { operation } = message
      dismissWhere((failure) => operation === undefined || failure.operation === operation)
      return
    }
    if (message.type !== "operationFailed") {
      return
    }
    const { failure } = message
    const isKnown =
      dismissed.current.includes(failure.serial) ||
      failures.some((shown) => shown.serial === failure.serial)
    if (!isKnown) {
      dismissWhere((shown) => shown.operation === failure.operation)
      failures = [...failures, failure]
    }
  })
  return {
    get current() {
      return failures
    },
    dismiss(serial) {
      dismissWhere((failure) => failure.serial === serial)
    },
    dismissAll() {
      dismissWhere(() => true)
    },
  }
}
