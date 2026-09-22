import * as vscode from "vscode"

import type { CourseIdentifier } from "../shared/shared"
import { backendName, LocalCourseData } from "../shared/shared"
import { Logger } from "../utilities"

/**
 * One row of a quick pick: what the user reads, what picking it yields, and an optional
 * dimmed note beside the label. Rows are resolved by identity, so two may share a label.
 */
export type Item<T> = [label: string, value: T, description?: string]

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
    return [options?.decorate?.(course, title) ?? title, value, backendName(course.kind)]
  })
}

/**
 * A class that provides a centralized interface to user dialogue.
 */
export default class Dialog {
  private static readonly _logsButton: NotificationButton = ["Show logs", (): void => Logger.show()]

  /**
   * Prompts the user with a yes/no dialog.
   *
   * @param prompt A prompt to present to the user.
   * @returns A Boolean indicating the answer or `undefined` if dialogue was dismissed.
   */
  public async confirmation(prompt: string): Promise<boolean | undefined> {
    return this.selectItem(prompt, ["Yes", true], ["No", false])
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
   * Prompts the user with a text input that requires explicitly typing a confirmation.
   *
   * @param prompt A prompt to be displayed to the user.
   * @returns True if and only if user typed `yes`.
   */
  public async explicitConfirmation(prompt: string): Promise<boolean> {
    return vscode.window
      .showInputBox({
        placeHolder: "Write 'Yes' to confirm or 'No' to cancel and press 'Enter'.",
        prompt,
      })
      .then((x) => x?.toLocaleLowerCase() === "yes")
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
   * @param items `[label, value]` tuples, optionally with a third element shown
   * dimmed next to the label. Items are resolved by identity rather than by
   * label, so two items may share a label as long as the description
   * distinguishes them.
   */
  public async selectItem<T>(
    prompt: string | { title: string; placeHolder: string },
    ...items: Item<T>[]
  ): Promise<T | undefined> {
    const options =
      typeof prompt === "string"
        ? { placeHolder: prompt }
        : { title: prompt.title, placeHolder: prompt.placeHolder }
    const picks = items.map(([label, value, description]) => ({
      label,
      value,
      ...(description !== undefined ? { description } : {}),
    }))
    return vscode.window.showQuickPick(picks, options).then((selection) => selection?.value)
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
    const pressed = await show(`TestMyCode: ${message}`, ...actions)
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
