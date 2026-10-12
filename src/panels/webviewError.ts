import { presentationFor } from "../errors"
import type { WebviewError } from "../shared/shared"
import { BaseError, RunnableCommandSchema } from "../shared/shared"

/**
 * Flattens anything thrown into a {@link WebviewError}: the sentence and remedy buttons a
 * notification of it would show, and its details.
 */
export function toWebviewError(thrown: unknown): WebviewError {
  const error = thrown instanceof Error ? thrown : new Error(String(thrown))
  const presentation = presentationFor(error)
  const actions = presentation.actions.flatMap(({ label, command }) => {
    const runnable = RunnableCommandSchema.safeParse(command)
    return runnable.success ? [{ label, command: runnable.data }] : []
  })
  return {
    message: presentation.message,
    ...(error instanceof BaseError && error.details ? { details: error.details } : {}),
    ...(actions.length > 0 ? { actions } : {}),
  }
}
