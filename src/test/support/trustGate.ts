import { vi } from "vitest"

import type { ReadyStartup } from "../../actions/types"
import { WorkspaceUntrustedError } from "../../errors"

/** A trust gate for a window in Restricted Mode, which records each retry it was handed. */
export function restrictedTrustGate(): {
  trustGate: ReadyStartup["trustGate"]
  retries: (() => void)[]
} {
  const retries: (() => void)[] = []
  const trustGate = {
    refusal: vi.fn((retry?: () => void) => {
      if (retry) {
        retries.push(retry)
      }
      return new WorkspaceUntrustedError("restricted")
    }),
    dispose: vi.fn(),
  } as unknown as ReadyStartup["trustGate"]
  return { trustGate, retries }
}
