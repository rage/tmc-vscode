import type {
  CourseDetailsPanel,
  ExerciseSubmissionPanel,
  ScreenFailure,
} from "../../../shared/lib"
import { addMessageListener } from "./script"
import { uiState } from "./uiState.svelte"

// Bounded: the host resends only its latest few, so an older serial never comes back.
const DISMISSALS_KEPT = 20

/** The failures of what a screen started, newest last, each until dismissed. */
export interface ScreenFailureList {
  readonly current: readonly ScreenFailure[]
  dismiss: (serial: number) => void
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
  addMessageListener(panel, (message) => {
    if (message.type !== "operationFailed") {
      return
    }
    const { failure } = message
    const isKnown =
      dismissed.current.includes(failure.serial) ||
      failures.some((shown) => shown.serial === failure.serial)
    if (!isKnown) {
      failures = [...failures, failure]
    }
  })
  return {
    get current() {
      return failures
    },
    dismiss(serial) {
      failures = failures.filter((failure) => failure.serial !== serial)
      dismissed.current = [...dismissed.current, serial].slice(-DISMISSALS_KEPT)
    },
  }
}
