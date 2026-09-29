import { within } from "@testing-library/svelte"

/**
 * Queries inside a `vscode-*` element's shadow root, once its first render has landed. Role
 * queries on `screen` do not pierce shadow roots, so a control rendered there (a checkbox's
 * input, a collapsible's heading) is only reachable this way.
 */
export async function withinShadowRoot(
  host: Element & { updateComplete?: Promise<unknown> },
): Promise<ReturnType<typeof within>> {
  await host.updateComplete
  if (!host.shadowRoot) {
    throw new Error(`<${host.localName}> has no shadow root; is it registered in elements.ts?`)
  }
  return within(host.shadowRoot as unknown as HTMLElement)
}
