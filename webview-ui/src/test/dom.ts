import { waitFor } from "@testing-library/svelte"

// `<vscode-button>` isn't upgraded under jsdom (its Lit ElementInternals calls throw), so it
// exposes no ARIA role and `getByRole("button", …)` can't find it. These helpers locate it by
// accessible name instead - aria-label, or trimmed text content.

function buttonName(el: Element): string {
  return el.getAttribute("aria-label") ?? el.textContent?.trim() ?? ""
}

/** Synchronously find the single `<vscode-button>` with the given accessible name. */
export function getButton(name: string): HTMLElement {
  const matches = Array.from(document.querySelectorAll<HTMLElement>("vscode-button")).filter(
    (el) => buttonName(el) === name,
  )
  const first = matches[0]
  if (!first) {
    throw new Error(`Unable to find a vscode-button named "${name}"`)
  }
  if (matches.length > 1) {
    throw new Error(`Found ${matches.length} vscode-buttons named "${name}"`)
  }
  return first
}

/** Wait for a `<vscode-button>` with the given accessible name to appear, then return it. */
export function findButton(name: string): Promise<HTMLElement> {
  return waitFor(() => getButton(name))
}
