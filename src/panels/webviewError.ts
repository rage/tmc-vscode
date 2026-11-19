import type { WebviewError } from "../../shared/lib"
import { toError } from "../../shared/lib"
import { errorDetails } from "../api/errorDetails"
import { AiUseRefusedError, isSubmitRefusal, NotEnrolledError, presentationFor } from "../errors"

/**
 * Flattens anything thrown into a {@link WebviewError}: the sentence and remedy buttons a
 * notification of it would show, and the id of its details for Show Details. A refusal by the
 * course's rules, or one held back on purpose, says all in its sentence and has no details.
 */
export function toWebviewError(thrown: unknown): WebviewError {
  const error = toError(thrown)
  const presentation = presentationFor(error)
  const { message, actions } = presentation
  const isFault =
    !presentation.isHeldBack &&
    !isSubmitRefusal(error) &&
    !(error instanceof NotEnrolledError) &&
    !(error instanceof AiUseRefusedError)
  return {
    message,
    ...(isFault ? { detailsId: errorDetails.record(message, error) } : {}),
    ...(actions.length > 0 ? { actions } : {}),
  }
}
