import type { Result } from "ts-results"
import { Err } from "ts-results"
import * as vscode from "vscode"

import { toError } from "../../shared/lib"
import { AiUseRefusedError, BottleneckError, presentationFor } from "../errors"
import { Logger } from "../utilities"
import type Dialog from "./dialog"
import type { FractionProgress, NotificationButton, ProgressLocation } from "./dialog"

/**
 * The screen an operation was started from, which shows its failure in place of a notification.
 * Implemented by the webview host, which this layer cannot reach.
 */
export interface FailureSink {
  /** Whether the student can see the screen now. */
  isVisible: () => boolean
  /**
   * Shows the failure on the screen as a notice: at once if it is on screen, else once it is
   * shown again.
   *
   * @param headline What was being done, e.g. "Failed to download the exercises."
   * @param error Supplies the rest of the sentence and its remedies; without it, `headline` is
   * the whole story.
   * @param tone `warning` for an operation held back rather than failed.
   */
  show: (headline: string, error: Error | undefined, tone: "error" | "warning") => void
}

/** Options for {@link withOperation}. */
export interface OperationOptions {
  /** Leads the notification when the operation fails, e.g. "Failed to add the course." */
  failure: string
  /**
   * Logs a failure or a busy rejection instead of showing it: for runs the user did not ask
   * for, and for entry points that render the failure themselves. An operation's
   * {@link Warned.warnings} are still shown.
   */
  silent?: boolean
  /**
   * The screen that started the operation: its failures, and its warnings, show there while it
   * is on screen. While it is not, they are notified too.
   */
  shownIn?: FailureSink
  /** Runs `body` under a progress notification with this message. */
  progress?: string
  /** Shows {@link progress} there instead of in a notification. */
  progressLocation?: ProgressLocation
}

/** A failure an operation carried on past, shown as an error notification led by `headline`. */
export interface OperationWarning {
  headline: string
  error: Error
}

/**
 * The success of an operation that carried on past failures. {@link withOperation} shows its
 * warnings; an entry point running the operation without it shows them with {@link reportWarnings}.
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

/** Logs the warnings of an operation that failed after them, its `Err` having no room for them. */
export function logWarnings(warnings: readonly OperationWarning[]): void {
  for (const { headline, error } of warnings) {
    Logger.error(headline, error)
  }
}

/**
 * Shows a failure that was not an operation's, such as a button that found nothing to act on, the
 * way {@link withOperation} shows an operation's in `shownIn`.
 *
 * @param error Supplies the rest of the sentence; without it, `headline` is the whole story.
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
 * @param cause The error behind it: the notification's detail and the log's. Omit it when
 * the headline is the whole story.
 */
export function failure(headline: string, cause?: Error): Err<Error> {
  return Err(new OperationFailure(headline, cause))
}

/**
 * Runs one operation on the user's behalf and reports how it failed, exactly once.
 *
 * Resolves to what `body` resolved to; a throw becomes an `Err`. Never rejects, and never waits
 * on the notification it shows. Success is the caller's to announce, but the warnings of a
 * {@link Warned} success are shown here. A busy rejection (`BottleneckError`) is shown as
 * information, not as an error.
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
  } else if (isWarned(result.val) && options.shownIn) {
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
  // Hidden, the screen keeps the failure for when it is shown again, and a notification says it now.
  const isShownInPlace = shownIn?.isVisible() === true

  // Not a fault: no failure headline and no Show Details, only the refusal and its one remedy.
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

  // Held back on purpose, so neither the failure headline nor a warning fits it.
  const busy = [detail, error].find((e) => e instanceof BottleneckError)
  if (busy) {
    Logger.info(`Not started: ${busy.message}`)
    if (!options.silent) {
      shownIn?.show(headline, busy, "warning")
    }
    if (!options.silent && !isShownInPlace) {
      void dialog.notification(busy.message)
    }
    return
  }

  if (options.silent) {
    Logger.warn(headline, detail)
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
