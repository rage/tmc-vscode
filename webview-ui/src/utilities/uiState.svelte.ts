import type { Panel } from "../shared/shared"
import { CourseIdentifier } from "../shared/shared"
import { snapshot } from "./snapshot.svelte"
import { vscode } from "./vscode"

// VS Code destroys a hidden panel's document and loads a new one on reveal, so UI state the
// host does not hold lives in the webview state bag, keyed by screen.

const SCROLL_KEY = "scrollY"

// Content arrives from the host after the screen mounts; past this, a restore that has not
// landed is given up rather than jumping the page while the student reads it.
const SCROLL_RESTORE_TIMEOUT_MS = 3_000

let screen: string | undefined
let values: Record<string, unknown> = {}
let pendingScrollY: number | undefined
let pendingScrollTimeout: ReturnType<typeof setTimeout> | undefined
let isScrollTracked = false

/** The key of `panel`'s saved UI state; panels sharing a key take up each other's state. */
function screenOf(panel: Panel): string {
  switch (panel.type) {
    case "CourseDetails":
      return `CourseDetails:${panel.courseId.kind}:${CourseIdentifier.toString(panel.courseId)}`
    // A new submission of the same exercise starts with an empty feedback form.
    case "ExerciseSubmission":
      return `ExerciseSubmission:${panel.id}`
    case "App":
    case "InitializationErrorHelp":
      return panel.type
  }
}

function save(): void {
  if (screen !== undefined) {
    vscode.setState({ screen, ui: values })
  }
}

/**
 * Makes `panel` the screen {@link uiState} reads and writes.
 *
 * Call before the panel's components are created. What was saved for the same screen is kept,
 * including the scroll position, which is restored once the content is tall enough; any other
 * screen's state is dropped.
 */
export function enterScreen(panel: Panel): void {
  const next = screenOf(panel)
  const saved = vscode.getState()
  values = saved?.screen === next ? { ...saved.ui } : {}
  screen = next
  save()
  trackScroll()
  const savedScrollY = values[SCROLL_KEY]
  setPendingScroll(typeof savedScrollY === "number" && savedScrollY > 0 ? savedScrollY : undefined)
  requestAnimationFrame(tryRestoreScroll)
}

/** Forgets the current screen and its UI state, as a newly loaded document starts out. */
export function leaveScreen(): void {
  screen = undefined
  values = {}
  setPendingScroll(undefined)
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

function setPendingScroll(scrollY: number | undefined): void {
  clearTimeout(pendingScrollTimeout)
  pendingScrollY = scrollY
  pendingScrollTimeout =
    scrollY === undefined
      ? undefined
      : setTimeout(() => setPendingScroll(undefined), SCROLL_RESTORE_TIMEOUT_MS)
}

function tryRestoreScroll(): void {
  if (pendingScrollY === undefined) {
    return
  }
  window.scrollTo(0, pendingScrollY)
  if (Math.abs(window.scrollY - pendingScrollY) < 1) {
    setPendingScroll(undefined)
  }
}

function trackScroll(): void {
  if (isScrollTracked) {
    return
  }
  isScrollTracked = true
  let isScrollSaveQueued = false
  window.addEventListener("scroll", () => {
    if (isScrollSaveQueued) {
      return
    }
    isScrollSaveQueued = true
    requestAnimationFrame(() => {
      isScrollSaveQueued = false
      // Scrolls clamped short of the target while the content is still arriving are not the
      // student's.
      if (pendingScrollY === undefined && screen !== undefined) {
        values[SCROLL_KEY] = window.scrollY
        save()
      }
    })
  })
  for (const type of ["wheel", "keydown", "pointerdown", "touchstart"]) {
    window.addEventListener(type, () => setPendingScroll(undefined), { passive: true })
  }
  if (typeof ResizeObserver === "function") {
    new ResizeObserver(tryRestoreScroll).observe(document.body)
  }
}
