import type { Result } from "ts-results"
import { Err } from "ts-results"

import { BottleneckError, presentationFor } from "../errors"
import type { BackendKind } from "../shared/shared"
import { Logger } from "../utilities"
import type Dialog from "./dialog"
import type { FractionProgress } from "./dialog"

/** Options for {@link withOperation}. */
export interface OperationOptions {
  /** Leads the notification when the operation fails, e.g. "Failed to add the course." */
  failure: string
  /** Names the site in the sentence; see {@link Dialog.reportError}. */
  backend?: BackendKind
  /**
   * Logs a failure or a busy rejection instead of showing it: for runs the user did not ask
   * for, and for entry points that render the failure themselves. Warnings the operation
   * reports for failures it carried on past are still shown.
   */
  silent?: boolean
  /** Runs `body` under a progress notification with this message. */
  progress?: string
}

class OperationFailure extends Error {
  public constructor(
    headline: string,
    cause: Error | undefined,
    public readonly backend: BackendKind | undefined,
  ) {
    super(headline, { cause })
  }
}

const shownInPanelErrors = new WeakSet<Error>()

/**
 * An `Err` whose sentence the notification leads with, instead of `OperationOptions.failure`.
 *
 * @param headline The whole sentence, in the user's vocabulary.
 * @param cause The error behind it: the notification's detail and the log's. Omit it when
 * the headline is the whole story.
 * @param backend Overrides `OperationOptions.backend` for this failure.
 */
export function failure(headline: string, cause?: Error, backend?: BackendKind): Err<Error> {
  return Err(new OperationFailure(headline, cause, backend))
}

/**
 * An `Err` for a failure a panel already shows. {@link withOperation} only logs it, unless
 * its presentation offers a remedy button the panel cannot, and then notifies as well.
 *
 * The `Err` carries `error` itself, and the mark survives wrapping it as a {@link failure}'s
 * cause.
 */
export function shownInPanel(error: Error): Err<Error> {
  shownInPanelErrors.add(error)
  return Err(error)
}

/**
 * Runs one operation on the user's behalf and reports how it failed, exactly once.
 *
 * Resolves to what `body` resolved to; a throw becomes an `Err`. Never rejects, and never waits
 * on the notification it shows. Success is the caller's to announce. A busy rejection
 * (`BottleneckError`) is shown as information, not as an error.
 *
 * @param body The operation. `report` feeds the progress bar when `options.progress` is set,
 * and does nothing otherwise.
 */
export async function withOperation<T>(
  dialog: Dialog,
  options: OperationOptions,
  body: (report: (progress: FractionProgress) => void) => Promise<Result<T, Error>>,
): Promise<Result<T, Error>> {
  let result: Result<T, Error>
  try {
    result = options.progress
      ? await dialog.progressNotification(options.progress, (progress) =>
          body((fraction) => progress.report(fraction)),
        )
      : await body(() => {})
  } catch (thrown) {
    result = Err(thrown instanceof Error ? thrown : new Error(String(thrown)))
  }
  if (result.err) {
    reportFailure(dialog, options, result.val)
  }
  return result
}

function reportFailure(dialog: Dialog, options: OperationOptions, error: Error): void {
  const [headline, detail, backend] =
    error instanceof OperationFailure
      ? [
          error.message,
          error.cause instanceof Error ? error.cause : undefined,
          error.backend ?? options.backend,
        ]
      : [options.failure, error, options.backend]

  const busy = [detail, error].find((e) => e instanceof BottleneckError)
  if (busy) {
    Logger.warn(headline, busy)
    if (!options.silent) {
      void dialog.notification(busy.message)
    }
    return
  }

  if (shownInPanelErrors.has(error) || (detail && shownInPanelErrors.has(detail))) {
    Logger.warn(headline, detail)
    if (!options.silent && detail && presentationFor(detail, backend).actions.length > 0) {
      void dialog.reportError(headline, detail, backend)
    }
    return
  }

  if (options.silent) {
    Logger.warn(headline, detail)
  } else if (detail) {
    void dialog.reportError(headline, detail, backend)
  } else {
    void dialog.errorNotification(headline, error)
  }
}
