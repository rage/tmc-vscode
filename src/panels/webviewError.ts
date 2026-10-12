import type { WebviewError } from "../../shared/lib"
import { BaseError, toError } from "../../shared/lib"
import { presentationFor } from "../errors"

/**
 * Flattens anything thrown into a {@link WebviewError}: the sentence and remedy buttons a
 * notification of it would show, and its details.
 */
export function toWebviewError(thrown: unknown): WebviewError {
  const error = toError(thrown)
  const { message, actions } = presentationFor(error)
  return {
    message,
    ...(error instanceof BaseError && error.details ? { details: error.details } : {}),
    ...(actions.length > 0 ? { actions } : {}),
  }
}
