import { tick } from "svelte"
import { prefersReducedMotion } from "svelte/motion"
import { createSubscriber } from "svelte/reactivity"

// Clearing and refilling on a later task is what makes a repeated message announce again.
const ANNOUNCE_DELAY_MS = 100

let liveRegion: HTMLElement | undefined
let pendingAnnouncement: ReturnType<typeof setTimeout> | undefined

/**
 * Mounts the app's single polite live region. Call once at startup: a region inserted together
 * with its first message is often not announced. `announce` mounts it lazily otherwise.
 */
export function mountAnnouncer(target: HTMLElement = document.body): HTMLElement {
  if (!liveRegion?.isConnected) {
    liveRegion = document.createElement("div")
    liveRegion.setAttribute("role", "status")
    liveRegion.setAttribute("aria-live", "polite")
    liveRegion.className = "visually-hidden"
    liveRegion.dataset.testid = "announcer"
    target.append(liveRegion)
  }
  return liveRegion
}

/**
 * Tells screen-reader users about an outcome they cannot see happen, such as "3 of 10 tests
 * passed" or "Course removed". Politely: the message waits for the current speech. Use a
 * `Notice` with `role="alert"` for errors that block the panel instead.
 */
export function announce(message: string): void {
  const region = mountAnnouncer()
  clearTimeout(pendingAnnouncement)
  region.textContent = ""
  pendingAnnouncement = setTimeout(() => {
    region.textContent = message
  }, ANNOUNCE_DELAY_MS)
}

/**
 * Attachment that moves focus to its element when it mounts, for the heading of a panel the
 * user navigated to (`<h1 tabindex="-1" {@attach focusOnMount}>`). Does nothing while the
 * webview is not focused, so a panel the host re-renders in the background never steals focus.
 */
export function focusOnMount(element: HTMLElement): void {
  if (document.hasFocus()) {
    element.focus({ preventScroll: true })
  }
}

/** Focuses a custom element, or the button in its shadow root when the host itself cannot hold focus. */
function focusControl(element: HTMLElement): void {
  element.focus({ preventScroll: true })
  if (!element.matches(":focus-within")) {
    element.shadowRoot?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true })
  }
}

/**
 * Attachment for the control that takes the place of one the user just activated: focuses its
 * element while `shouldFocus()` holds, then calls `done`. Skipped when focus is already
 * somewhere, so a slow action never pulls focus back from where the user went meanwhile.
 */
export function focusWhen(
  shouldFocus: () => boolean,
  done: () => void,
): (element: HTMLElement) => void {
  return (element) => {
    if (!shouldFocus()) {
      return
    }
    done()
    // A custom element is not focusable until it has rendered.
    const rendered = (element as { updateComplete?: Promise<unknown> }).updateComplete
    void Promise.resolve(rendered).then(() => {
      if (
        element.isConnected &&
        (!document.activeElement || document.activeElement === document.body)
      ) {
        focusControl(element)
      }
    })
  }
}

/**
 * Runs `dismiss` for the notice that contains `button`, then moves focus to the next dismiss
 * button (marked `data-dismiss`), else to the panel's heading, so the removed button does not drop
 * focus to `<body>`.
 */
export async function dismissKeepingFocus(button: Element, dismiss: () => void): Promise<void> {
  const buttons = [...document.querySelectorAll<HTMLElement>("[data-dismiss]")]
  const next = buttons[buttons.indexOf(button as HTMLElement) + 1]
  dismiss()
  await tick()
  const target = next?.isConnected ? next : document.querySelector<HTMLElement>("h1")
  if (target) {
    focusControl(target)
  }
}

class ReducedMotion {
  readonly #subscribe = createSubscriber((update) => {
    const observer = new MutationObserver(update)
    observer.observe(document.body, { attributes: true, attributeFilter: ["class"] })
    return () => observer.disconnect()
  })

  /** Whether the OS or VS Code's `workbench.reduceMotion` asks for less motion. */
  public get current(): boolean {
    this.#subscribe()
    return prefersReducedMotion.current || document.body.classList.contains("vscode-reduce-motion")
  }
}

/**
 * Reactive reduced-motion preference for motion CSS cannot reach: Svelte transitions
 * (`transition:slide={{ duration: reducedMotion.current ? 0 : 200 }}`) and `spin` on icons.
 * VS Code's setting reaches the webview only as a body class, not through the media query.
 */
export const reducedMotion = new ReducedMotion()
