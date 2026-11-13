import type { WebviewError } from "../../shared/lib"
import { BaseError, toError } from "../../shared/lib"
import { isSubmitRefusal, NotEnrolledError, presentationFor } from "../errors"

/**
 * Flattens anything thrown into a {@link WebviewError}: the sentence and remedy buttons a
 * notification of it would show, and its details. A backend's refusal by the course's rules
 * says all in its sentence, so its details, the HTTP exchange, stay in the log.
 */
export function toWebviewError(thrown: unknown): WebviewError {
  const error = toError(thrown)
  const { message, actions } = presentationFor(error)
  return {
    message,
    ...(error instanceof BaseError && error.details && !isRefusal(error)
      ? { details: error.details }
      : {}),
    ...(actions.length > 0 ? { actions } : {}),
  }
}

function isRefusal(error: Error): boolean {
  return isSubmitRefusal(error) || error instanceof NotEnrolledError
}
