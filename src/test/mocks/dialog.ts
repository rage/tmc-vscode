import { vi } from "vitest"

import type Dialog from "../../api/dialog"
import { autoMock } from "../support/mock"

export interface DialogMockValues {
  confirmation: boolean | undefined
}

export function createDialogMock(): [Dialog, DialogMockValues] {
  const values: DialogMockValues = {
    confirmation: true,
  }

  const explicit: Partial<Record<keyof Dialog, unknown>> = {
    confirmation: vi.fn(async () => values.confirmation),
    progressNotification: vi.fn(
      (_message: string, task: (progress: { report: () => void }) => unknown) =>
        task({ report: () => {} }),
    ),
  }

  // Any other dialog method (errorNotification, warningNotification, …) is a
  // loose no-op spy.
  const fallback = autoMock<Dialog>()
  const mock = new Proxy(explicit, {
    get(target, prop) {
      return prop in target
        ? Reflect.get(target, prop)
        : (fallback as unknown as Record<PropertyKey, unknown>)[prop]
    },
  })

  return [mock as unknown as Dialog, values]
}
