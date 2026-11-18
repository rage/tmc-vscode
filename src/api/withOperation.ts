import type { Result } from "ts-results"
import { Err } from "ts-results"
import * as vscode from "vscode"

import type { ExerciseIdentifier } from "../../shared/lib"
import { toError } from "../../shared/lib"
import { AiUseRefusedError, BottleneckError, presentationFor } from "../errors"
import { Logger } from "../utilities"
import type Dialog from "./dialog"
import type { FractionProgress, NotificationButton, ProgressLocation } from "./dialog"

/**
 * The screen an operation started from, showing its failure in place of a notification.
 * Implemented by the webview host.
 */
export interface FailureSink {
  /** Whether the student can see the screen now. */
  isVisible: () => boolean
  /**
   * Shows the failure as a notice: at once if the screen is visible, else once it is shown again.
   *
   * @param headline What was being done, e.g. "Failed to download the exercises."
   * @param error Supplies the rest of the sentence and its remedies.
   * @param tone `warning` for an operation held back rather than failed.
   */
  show: (headline: string, error: Error | undefined, tone: "error" | "warning") => void
  /** Takes back the failures {@link show} was given for `headline`. */
  clear: (headline: string) => void
}

/** Options for {@link withOperation}. */
export interface OperationOptions {
  /** Leads the notification when the operation fails, e.g. "Failed to add the course." */
  failure: string
  /**
   * Logs a failure or busy rejection instead of showing it: for runs the user did not ask for
   * and entry points that render the failure themselves. {@link Warned.warnings} still show.
   */
  silent?: boolean
  /**
   * The screen that started the operation: failures and warnings show there while it is
   * visible, and are notified otherwise.
   */
  shownIn?: FailureSink
  /**
   * The student did not start the operation: a busy rejection (another operation already does
   * its work) is only logged. Other failures still show.
   */
  isBackground?: boolean
  /** Runs `body` under a progress notification with this message. */
  progress?: string
  /** Shows {@link progress} there instead of in a notification. */
  progressLocation?: ProgressLocation
}

/** A failure an operation carried on past, shown as an error notification led by `headline`. */
export interface OperationWarning {
  headline: string
  error: Error
  /** The exercises that failed, when the warning is about them, for a screen listing them. */
  failedExercises?: ExerciseIdentifier[]
}

/**
 * The success of an operation that carried on past failures. {@link withOperation} shows the
 * warnings; callers running the operation without it use {@link reportWarnings}.
 */
export interface Warned {
  warnings: OperationWarning[]
}

/** Shows each warning as its own error notification. */
export function reportWarnings(dialog: Dialog, warnings: readonly OperationWarning[]): void {
  for (const { headline, error } of warnings) {
    void dialog.reportError(headline, error)
  }
}

/** Logs the warnings of an operation that then failed; its `Err` has no room for them. */
export function logWarnings(warnings: readonly OperationWarning[]): void {
  for (const { headline, error } of warnings) {
    Logger.error(headline, error)
  }
}

/**
 * Shows a failure that was not an operation's, such as a button that found nothing to act on,
 * the way {@link withOperation} does in `shownIn`.
 *
 * @param error Supplies the rest of the sentence.
 */
export function reportFailureIn(
  dialog: Dialog,
  shownIn: FailureSink,
  headline: string,
  error?: Error,
): void {
  reportFailure(dialog, { failure: headline, shownIn }, error ?? new OperationFailure(headline))
}

function isWarned(value: unknown): value is Warned {
  return typeof value === "object" && value !== null && Array.isArray((value as Warned).warnings)
}

class OperationFailure extends Error {
  public constructor(headline: string, cause?: Error) {
    super(headline, { cause })
  }
}

/**
 * An `Err` whose sentence the notification leads with, instead of `OperationOptions.failure`.
 *
 * @param headline The whole sentence, in the user's vocabulary.
 * @param cause The error behind it: the notification's detail and the log's.
 */
export function failure(headline: string, cause?: Error): Err<Error> {
  return Err(new OperationFailure(headline, cause))
}

/**
 * Runs one operation on the user's behalf and reports how it failed, exactly once.
 *
 * Resolves to what `body` resolved to; a throw becomes an `Err`. Never rejects or waits on the
 * notification it shows. Success is the caller's to announce, but {@link Warned} warnings are
 * shown here. A busy rejection (`BottleneckError`) shows as information, not an error.
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
      ? await dialog.progressNotification(
          options.progress,
          (progress) => body((fraction) => progress.report(fraction)),
          options.progressLocation ? { location: options.progressLocation } : undefined,
        )
      : await body(() => {})
  } catch (thrown) {
    result = Err(toError(thrown))
  }
  if (result.err) {
    reportFailure(dialog, options, result.val)
    return result
  }
  options.shownIn?.clear(options.failure)
  if (isWarned(result.val) && options.shownIn) {
    for (const { headline, error } of result.val.warnings) {
      reportFailureIn(dialog, options.shownIn, headline, error)
    }
  } else if (isWarned(result.val)) {
    reportWarnings(dialog, result.val.warnings)
  }
  return result
}

function reportFailure(dialog: Dialog, options: OperationOptions, error: Error): void {
  const [headline, detail] =
    error instanceof OperationFailure
      ? [error.message, error.cause instanceof Error ? error.cause : undefined]
      : [options.failure, error]
  const { shownIn } = options
  // Hidden, the screen keeps the failure for later and a notification says it now.
  const isShownInPlace = shownIn?.isVisible() === true

  // Not a fault: no failure headline or Show Details, only the refusal and its remedy.
  const refused = [detail, error].find((e) => e instanceof AiUseRefusedError)
  if (refused) {
    Logger.info(headline, refused)
    if (!options.silent) {
      shownIn?.show(headline, refused, "warning")
    }
    if (!options.silent && !isShownInPlace) {
      const presentation = presentationFor(refused)
      void dialog.warningNotification(
        presentation.message,
        ...presentation.actions.map<NotificationButton>(({ label, command }) => [
          label,
          (): void => void vscode.commands.executeCommand(command),
        ]),
      )
    }
    return
  }

  // Held back on purpose: neither the failure headline nor a warning fits.
  const busy = [detail, error].find((e) => e instanceof BottleneckError)
  if (busy) {
    Logger.info(`Not started: ${busy.message}`)
    const isShown = !options.silent && !options.isBackground
    if (isShown) {
      shownIn?.show(headline, busy, "warning")
    }
    if (isShown && !isShownInPlace) {
      void dialog.notification(busy.message)
    }
    return
  }

  if (options.silent) {
    Logger.warn(headline, detail)
    return
  }
  // Logged out, the screen's own notice asks to log in; elsewhere the neutral prompt does.
  if (detail && dialog.noteSessionLost(detail)) {
    if (isShownInPlace) {
      Logger.info(headline, detail)
    } else {
      void dialog.reportError(headline, detail)
    }
    return
  }
  const isHeldBack = detail !== undefined && presentationFor(detail).isHeldBack === true
  shownIn?.show(headline, detail, isHeldBack ? "warning" : "error")
  if (isShownInPlace) {
    if (isHeldBack) {
      Logger.info(headline, detail)
    } else {
      Logger.error(headline, detail ?? error)
    }
  } else if (detail) {
    void dialog.reportError(headline, detail)
  } else {
    void dialog.errorNotification(headline, error)
  }
}
