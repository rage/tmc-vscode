import type { Panel, RestorableRoute } from "../shared/shared"
import { CourseIdentifier } from "../shared/shared"
import { snapshot } from "./snapshot.svelte"
import { vscode } from "./vscode"

// VS Code destroys a hidden panel's document and loads a new one on reveal, so UI state the
// host does not hold lives in the webview state bag, keyed by screen. The bag also names the
// screen, for the host's panel serializer to reopen after a window reload.

const SCROLL_KEY = "scrollY"

// Saves a scroll once it settles: each save copies the screen's whole state to the host.
const SCROLL_SAVE_DELAY_MS = 200

let screen: string | undefined
let route: RestorableRoute | undefined
let values: Record<string, unknown> = {}
// Where the current screen is to scroll back to once its content has rendered.
let pendingScrollY: number | undefined
let scrollSaveTimeout: ReturnType<typeof setTimeout> | undefined
let isScrollTracked = false

/** The key of `panel`'s saved UI state; panels sharing a key take up each other's state. */
function screenOf(panel: Panel): string {
  switch (panel.type) {
    case "CourseDetails":
      return `CourseDetails:${CourseIdentifier.key(panel.courseId)}`
    // A new submission of the same exercise starts with an empty feedback form.
    case "ExerciseSubmission":
      return `ExerciseSubmission:${panel.id}`
    case "InitializationErrorHelp":
      return panel.type
  }
}

// A submission's view lives only in the host's memory, which a window reload clears.
function restorableRouteOf(panel: Panel): RestorableRoute | undefined {
  switch (panel.type) {
    case "CourseDetails":
      return { type: panel.type, courseId: panel.courseId }
    case "InitializationErrorHelp":
      return { type: panel.type }
    case "ExerciseSubmission":
      return undefined
  }
}

function save(): void {
  if (screen !== undefined) {
    vscode.setState({ screen, ...(route ? { route } : {}), ui: values })
  }
}

/**
 * Makes `panel` the screen {@link uiState} reads and writes.
 *
 * Call before the panel's components are created. What was saved for the same screen is kept,
 * including the scroll position, which {@link restoreScroll} returns to; any other screen's
 * state is dropped.
 */
export function enterScreen(panel: Panel): void {
  const next = screenOf(panel)
  const saved = vscode.getState()
  values = saved?.screen === next ? { ...saved.ui } : {}
  screen = next
  route = restorableRouteOf(panel)
  save()
  trackScroll()
  clearTimeout(scrollSaveTimeout)
  scrollSaveTimeout = undefined
  const savedScrollY = values[SCROLL_KEY]
  pendingScrollY = typeof savedScrollY === "number" && savedScrollY > 0 ? savedScrollY : undefined
}

/**
 * Scrolls back to where the student left the current screen.
 *
 * A screen calls it once, when its content has rendered: before that the saved position can
 * lie past the end of the page, so scrolls are not saved until then.
 */
export function restoreScroll(): void {
  if (pendingScrollY !== undefined) {
    window.scrollTo(0, pendingScrollY)
    pendingScrollY = undefined
  }
}

/** Forgets the current screen and its UI state, as a newly loaded document starts out. */
export function leaveScreen(): void {
  screen = undefined
  route = undefined
  values = {}
  pendingScrollY = undefined
}

/**
 * A value of the current screen's UI state that survives the panel being hidden and shown.
 *
 * Call during component initialization, after {@link enterScreen}. `name` must be unique on the
 * screen. A saved value of a different kind than `initial` is ignored. Assign `current` a new
 * value to save it; mutating it in place saves nothing.
 */
export function uiState<T>(name: string, initial: T): { current: T } {
  const owner = screen
  const saved = values[name]
  let value = $state.raw<T>(isSameKind(saved, initial) ? (saved as T) : initial)
  return {
    get current() {
      return value
    },
    set current(next: T) {
      value = next
      // A component of a screen already left must not write into the next one's state.
      if (owner !== undefined && owner === screen) {
        values[name] = snapshot(next)
        save()
      }
    },
  }
}

// A `null` initial value admits anything saved, as for a link that is absent until fetched.
function isSameKind(saved: unknown, initial: unknown): boolean {
  if (saved === undefined) {
    return false
  }
  if (initial === null || saved === null) {
    return true
  }
  return typeof saved === typeof initial && Array.isArray(saved) === Array.isArray(initial)
}

function saveScroll(): void {
  clearTimeout(scrollSaveTimeout)
  scrollSaveTimeout = undefined
  if (pendingScrollY === undefined && screen !== undefined) {
    values[SCROLL_KEY] = window.scrollY
    save()
  }
}

function trackScroll(): void {
  if (isScrollTracked) {
    return
  }
  isScrollTracked = true
  window.addEventListener(
    "scroll",
    () => {
      clearTimeout(scrollSaveTimeout)
      scrollSaveTimeout = setTimeout(saveScroll, SCROLL_SAVE_DELAY_MS)
    },
    { passive: true },
  )
  // VS Code destroys a hidden panel's document without waiting for a delayed save.
  const flushScroll = (): void => {
    if (scrollSaveTimeout !== undefined) {
      saveScroll()
    }
  }
  window.addEventListener("pagehide", flushScroll)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      flushScroll()
    }
  })
}
