import * as vscode from "vscode"

import { presentationFor } from "../errors"
import type { BackendKind, CourseIdentifier } from "../shared/shared"
import { backendName, LocalCourseData } from "../shared/shared"
import { Logger } from "../utilities"

/**
 * One row of a quick pick: what the user reads and what picking it yields. Rows are
 * resolved by identity, so two may share a label.
 */
export interface Item<T> {
  label: string
  value: T
  /** Dimmed, beside the label. */
  description?: string
  /** Dimmed, on a line of its own. */
  detail?: string
  iconPath?: vscode.ThemeIcon
}

/**
 * A notification button: its label, and what pressing it does. Buttons are
 * resolved by identity rather than by label, so two may share a label.
 */
type NotificationButton = [label: string, callback: () => void]

type NotificationAction = vscode.MessageItem & { callback: () => void }

type ShowNotification = (
  message: string,
  ...actions: NotificationAction[]
) => Thenable<NotificationAction | undefined>

/** A progress report giving absolute completion as a 0..1 fraction. */
export interface FractionProgress {
  message?: string | undefined
  fraction: number
}

interface CourseSelectionOptions<T> {
  /**
   * Replaces the label for one course, given the course and the title it would otherwise
   * get — for marking the workspace that is already open, and nothing heavier.
   */
  decorate?: (course: LocalCourseData, title: string) => string
  /** What picking the course yields. Defaults to its {@link CourseIdentifier}. */
  value?: (course: LocalCourseData) => T
}

/**
 * Quick-pick rows for a list of courses, labelled by course title and described by the
 * backend they come from.
 *
 * Every place the user chooses among their courses builds its rows here: titles are only
 * unique within one backend, so a list that omits the backend can show two rows a student
 * cannot tell apart.
 */
export function courseSelectionItems(
  courses: readonly LocalCourseData[],
  options?: CourseSelectionOptions<CourseIdentifier>,
): Item<CourseIdentifier>[]
export function courseSelectionItems<T>(
  courses: readonly LocalCourseData[],
  options: CourseSelectionOptions<T> & { value: (course: LocalCourseData) => T },
): Item<T>[]
export function courseSelectionItems<T>(
  courses: readonly LocalCourseData[],
  options?: CourseSelectionOptions<T>,
): Item<T | CourseIdentifier>[] {
  return courses.map((course) => {
    const title = LocalCourseData.getCourseTitle(course)
    const value = options?.value ? options.value(course) : LocalCourseData.getCourseId(course)
    return {
      label: options?.decorate?.(course, title) ?? title,
      value,
      description: backendName(course.kind),
    }
  })
}

/**
 * A class that provides a centralized interface to user dialogue.
 */
export default class Dialog {
  private static readonly _logsButton: NotificationButton = ["Show logs", (): void => Logger.show()]

  /**
   * Asks the user to confirm an action, in a modal dialog.
   *
   * @param message The question, naming what the action acts on, e.g. "Close part01-01?".
   * @param options `confirmLabel` is the verb on the confirm button, e.g. "Close Exercise";
   * the dialog adds Cancel itself. `detail` says what follows from confirming.
   * @returns Whether the user confirmed. Cancel, Escape and closing the dialog all say no.
   */
  public async confirm(
    message: string,
    options: { confirmLabel: string; detail?: string },
  ): Promise<boolean> {
    const confirmed = await this.choose(message, options, [options.confirmLabel, true])
    return confirmed === true
  }

  /**
   * Offers the user several ways to go ahead with an action, in a modal dialog.
   *
   * For one way plus Cancel, use {@link confirm}.
   *
   * @param choices `[label, value]` pairs, one button each; the dialog adds Cancel itself.
   * @returns The chosen value, or `undefined` for Cancel.
   */
  public async choose<T>(
    message: string,
    options: { detail?: string },
    ...choices: [label: string, value: T][]
  ): Promise<T | undefined> {
    const items = choices.map(([title, value]) => ({ title, value }))
    const modal: vscode.MessageOptions = { modal: true }
    if (options.detail !== undefined) {
      modal.detail = options.detail
    }
    const chosen = await vscode.window.showWarningMessage(message, modal, ...items)
    return chosen?.value
  }

  /**
   * Wrapper for `vscode.window.showErrorMessage` that resolves optional items to associated
   * callbacks.
   */
  public async errorNotification(
    notification: string,
    error?: Error,
    ...items: NotificationButton[]
  ): Promise<void> {
    if (error) {
      Logger.error(notification, error)
    }
    const buttons = error ? items.concat([Dialog._logsButton]) : items

    return this._notify(vscode.window.showErrorMessage, notification, buttons)
  }

  /**
   * Reports a failed operation: `message` says what was being done, and `error` supplies
   * the rest of the sentence and any buttons its class prescribes.
   *
   * The notification carries the sentence and nothing else: the error's diagnostics —
   * details, cause chain and stack — go to the output channel behind the "Show logs"
   * button, which {@link Logger} writes in full.
   *
   * @param backend The backend the operation ran against, where the caller knows it; it
   * lets the sentence name the site for errors either backend can raise.
   */
  public async reportError(message: string, error: Error, backend?: BackendKind): Promise<void> {
    const presentation = presentationFor(error, backend)
    const buttons = presentation.actions.map<NotificationButton>(({ label, command }) => [
      label,
      (): void => void vscode.commands.executeCommand(command),
    ])
    return this.errorNotification(`${message} ${presentation.message}`, error, ...buttons)
  }

  /**
   * Asks the user to type `word` to confirm, for an action nothing can undo.
   *
   * Everything else confirms with {@link confirm}: typing is friction only data loss earns.
   *
   * @returns Whether the user typed `word`, ignoring case. Escape says no.
   */
  public async explicitConfirmation(prompt: string, word = "Yes"): Promise<boolean> {
    const matches = (value: string): boolean =>
      value.trim().toLocaleLowerCase() === word.toLocaleLowerCase()
    const typed = await vscode.window.showInputBox({
      prompt,
      placeHolder: `Type ${word} to confirm, or press Escape to cancel`,
      ignoreFocusOut: true,
      validateInput: (value) =>
        value === "" || matches(value) ? undefined : `Type ${word} to confirm.`,
    })
    return typed !== undefined && matches(typed)
  }

  /**
   * Wrapper for `vscode.window.showInformationMessage` that resolves optional items to their
   * associated callbacks.
   */
  public async notification(message: string, ...items: NotificationButton[]): Promise<void> {
    return this._notify(vscode.window.showInformationMessage, message, items)
  }

  /**
   * Shows a progress notification to the user.
   *
   * @param message A prompt to be displayed to the user.
   * @param task Long task that determines the duration of the notification.
   * The cancellation token only fires when `cancellable` is set.
   * @param options Set `cancellable` to offer a Cancel button.
   */
  public async progressNotification<T>(
    message: string,
    task: (
      progress: vscode.Progress<FractionProgress>,
      token: vscode.CancellationToken,
    ) => Promise<T>,
    options?: { cancellable?: boolean },
  ): Promise<T> {
    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: "TestMyCode",
        cancellable: options?.cancellable ?? false,
      },
      (progress, token) => {
        progress.report({ message, increment: 0 })
        const fractionProgress = this._fractionProgressWrapper(progress)

        return task(fractionProgress, token)
      },
    )
  }

  /**
   * Prompts the user with a selection of items and returns their corresponding value.
   *
   * @param prompt The quick pick's placeholder, or an object also giving the
   * pick a title for context.
   * @param items The rows, resolved by identity: two may share a label as long as the
   * description tells them apart.
   */
  public async selectItem<T>(
    prompt: string | { title: string; placeHolder: string },
    ...items: Item<T>[]
  ): Promise<T | undefined> {
    const options =
      typeof prompt === "string"
        ? { placeHolder: prompt }
        : { title: prompt.title, placeHolder: prompt.placeHolder }
    const picked = await vscode.window.showQuickPick(items, options)
    return picked?.value
  }

  /**
   * Wrapper for `vscode.window.showWarningMessage` that resolves optional items to associated
   * callbacks.
   */
  public async warningNotification(message: string, ...items: NotificationButton[]): Promise<void> {
    return this._notify(vscode.window.showWarningMessage, message, items)
  }

  /**
   * Shows `message` with one button per item and runs the pressed button's callback.
   *
   * @param show the `vscode.window.show*Message` overload taking `MessageItem`s,
   * which returns the pressed item itself, so duplicate labels stay distinct.
   */
  private async _notify(
    show: ShowNotification,
    message: string,
    buttons: NotificationButton[],
  ): Promise<void> {
    const actions = buttons.map(([title, callback]) => ({ title, callback }))
    const pressed = await show(message, ...actions)
    pressed?.callback()
  }

  /**
   * Wraps increment-style `vscode.Progress` with a version that takes an absolute
   * completion fraction instead. This is mostly useful when using
   * `vscode.window.withProgress`.
   *
   * Callers may report a fraction lower than a previous report; the bar then
   * stays where it is, but the report's message is still shown.
   */
  private _fractionProgressWrapper(
    progress: vscode.Progress<{ message?: string; increment: number }>,
  ): vscode.Progress<FractionProgress> {
    let peak = 0
    const report: (value: FractionProgress) => void = ({ message, fraction }) => {
      const increment = Math.max(0, 100 * (fraction - peak))
      if (increment === 0 && message === undefined) {
        return
      }
      progress.report({ increment, ...(message !== undefined ? { message } : {}) })
      peak = Math.max(peak, fraction)
    }

    return { report }
  }
}
