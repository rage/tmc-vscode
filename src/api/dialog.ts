import * as vscode from "vscode"

import type { CourseIdentifier } from "../../shared/lib"
import { backendName, LocalCourseData, NOT_LOGGED_IN_MESSAGE } from "../../shared/lib"
import { isSessionLost, presentationFor } from "../errors"
import { Logger } from "../utilities"
import { errorDetails } from "./errorDetails"

/** One quick-pick row: what the user reads and what picking it yields. */
export interface Item<T> {
  label: string
  value: T
  /** Dimmed, beside the label. */
  description?: string
  /** Dimmed, on a line of its own. */
  detail?: string
  iconPath?: vscode.ThemeIcon
}

/** A heading between groups of {@link Item}s, which the user cannot pick. */
export interface Separator {
  label: string
  kind: vscode.QuickPickItemKind.Separator
}

export function separator(label: string): Separator {
  return { label, kind: vscode.QuickPickItemKind.Separator }
}

/** A notification button: label and press callback. Resolved by identity, so labels may repeat. */
export type NotificationButton = [label: string, callback: () => void]

type NotificationAction = vscode.MessageItem & { callback: () => void }

const STATUS_MESSAGE_MS = 5000

/** Opens the help screen on the failure an id from `errorDetails` names. */
export const SHOW_ERROR_DETAILS_COMMAND = "tmc.showErrorDetails"

type ShowNotification = (
  message: string,
  ...actions: NotificationAction[]
) => Thenable<NotificationAction | undefined>

/** Where a progress indicator shows. */
export type ProgressLocation = vscode.ProgressLocation | { viewId: string }

/** A progress report giving absolute completion as a 0..1 fraction. */
export interface FractionProgress {
  message?: string | undefined
  fraction: number
}

/**
 * Quick-pick rows for courses, labelled by title and described by backend only where titles
 * collide. Titles are unique only within one backend, so every course picker builds rows here.
 *
 * @param decorate Replaces one course's label, given the title it would otherwise get.
 */
export function courseSelectionItems(
  courses: readonly LocalCourseData[],
  decorate?: (course: LocalCourseData, title: string) => string,
): Item<CourseIdentifier>[] {
  const titles = courses.map((course) => LocalCourseData.getCourseTitle(course))
  return courses.map((course, index) => {
    const title = titles[index] ?? LocalCourseData.getCourseTitle(course)
    const isTitleShared = titles.filter((other) => other === title).length > 1
    return {
      label: decorate?.(course, title) ?? title,
      value: LocalCourseData.getCourseId(course),
      ...(isTitleShared ? { description: backendName(course.kind) } : {}),
    }
  })
}

/** The single interface to user dialogs: confirmations, notifications, progress and pickers. */
export default class Dialog {
  private _reportSessionLost: ((cause: Error) => boolean) | undefined

  /**
   * Asks the user to confirm an action, in a modal dialog.
   *
   * @param message The question, naming what the action acts on.
   * @param options `confirmLabel` is the verb on the confirm button; Cancel is added.
   * `detail` says what follows from confirming.
   * @returns Whether the user confirmed; Cancel, Escape and closing all say no.
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
   * Shows an error notification with `items` as buttons.
   *
   * @param error What failed: logged, and kept for the Show Details button it adds.
   */
  public async errorNotification(
    notification: string,
    error?: Error,
    ...items: NotificationButton[]
  ): Promise<void> {
    const buttons = [...items]
    if (error) {
      Logger.error(notification, error)
      const detailsId = errorDetails.record(notification, error)
      buttons.push([
        "Show Details",
        (): void => void vscode.commands.executeCommand(SHOW_ERROR_DETAILS_COMMAND, detailsId),
      ])
    }

    return this._notify(vscode.window.showErrorMessage, notification, buttons)
  }

  /**
   * Takes over {@link reportError}'s notification for a lost session, which the session's own
   * warning already covers; `undefined` hands it back. The reporter returns `false` for a
   * session the user logged out of, which gets a neutral Log In prompt instead.
   */
  public setSessionLostReporter(reporter: ((cause: Error) => boolean) | undefined): void {
    this._reportSessionLost = reporter
  }

  /**
   * Tells the session's own warning about `error` if it is a lost session, for failures shown
   * somewhere other than {@link reportError}.
   *
   * @returns Whether `error` is just a missing session (logged out or never logged in), which is
   * no failure to show: the screen's logged-out notice already asks to log in.
   */
  public noteSessionLost(error: Error): boolean {
    if (this._reportSessionLost && isSessionLost(error)) {
      return !this._reportSessionLost(error)
    }
    return false
  }

  /**
   * Reports a failed operation: `message` says what was being done, `error` supplies the rest
   * of the sentence and any buttons its class prescribes. Diagnostics sit behind "Show Details".
   * An error that only held the operation back, such as Restricted Mode, is a warning with the
   * error's sentence alone.
   */
  public async reportError(message: string, error: Error): Promise<void> {
    if (this._reportSessionLost && isSessionLost(error)) {
      Logger.warn(message, error)
      if (!this._reportSessionLost(error)) {
        await this.notification(NOT_LOGGED_IN_MESSAGE, [
          "Log In",
          (): void => void vscode.commands.executeCommand("tmc.showMoocLogin"),
        ])
      }
      return
    }
    const presentation = presentationFor(error)
    const buttons = presentation.actions.map<NotificationButton>(({ label, command }) => [
      label,
      (): void => void vscode.commands.executeCommand(command),
    ])
    if (presentation.isHeldBack) {
      Logger.info(message, error)
      return this.warningNotification(presentation.message, ...buttons)
    }
    return this.errorNotification(`${message} ${presentation.message}`, error, ...buttons)
  }

  /**
   * Asks the user to type `word` to confirm an irreversible action. Use {@link confirm}
   * otherwise: typing is friction only data loss earns.
   *
   * @returns Whether the user typed `word`, case-sensitively. Escape says no.
   */
  public async explicitConfirmation(prompt: string, word = "Yes"): Promise<boolean> {
    const matches = (value: string): boolean => value.trim() === word
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
   * Shows an information notification with `items` as buttons.
   */
  public async notification(message: string, ...items: NotificationButton[]): Promise<void> {
    return this._notify(vscode.window.showInformationMessage, message, items)
  }

  /**
   * Offers one action in an information notification.
   *
   * @returns Whether the user pressed `action`; dismissing the notification says no.
   */
  public async offer(message: string, action: string): Promise<boolean> {
    let isPressed = false
    await this.notification(message, [action, (): void => void (isPressed = true)])
    return isPressed
  }

  /**
   * Shows progress for `task` for as long as it runs.
   *
   * @param task Its cancellation token only fires when `cancellable` is set.
   * @param options Set `cancellable` to offer a Cancel button. `location` defaults to a
   * notification; a view location shows the view's own progress bar instead, and no message.
   */
  public async progressNotification<T>(
    message: string,
    task: (
      progress: vscode.Progress<FractionProgress>,
      token: vscode.CancellationToken,
    ) => Promise<T>,
    options?: { cancellable?: boolean; location?: ProgressLocation },
  ): Promise<T> {
    return vscode.window.withProgress(
      {
        location: options?.location ?? vscode.ProgressLocation.Notification,
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
   * Prompts the user to pick one of `items` and returns its value, or `undefined` if dismissed.
   *
   * @param prompt The quick pick's placeholder, or an object also giving it a title.
   * @param items Resolved by identity: rows may share a label if the description tells them apart.
   */
  public async selectItem<T>(
    prompt: string | { title: string; placeHolder: string; matchOnDescription?: boolean },
    ...items: (Item<T> | Separator)[]
  ): Promise<T | undefined> {
    const options: vscode.QuickPickOptions =
      typeof prompt === "string"
        ? { placeHolder: prompt }
        : {
            title: prompt.title,
            placeHolder: prompt.placeHolder,
            ...(prompt.matchOnDescription ? { matchOnDescription: true } : {}),
          }
    const picked = await vscode.window.showQuickPick(items, options)
    return picked && "value" in picked ? picked.value : undefined
  }

  /**
   * Announces a finished operation in the status bar for a few seconds. Anything the user
   * may act on belongs in {@link notification}.
   */
  public statusMessage(message: string): void {
    vscode.window.setStatusBarMessage(message, STATUS_MESSAGE_MS)
  }

  /**
   * Shows a warning notification with `items` as buttons.
   */
  public async warningNotification(message: string, ...items: NotificationButton[]): Promise<void> {
    return this._notify(vscode.window.showWarningMessage, message, items)
  }

  /**
   * Shows `message` with one button per item and runs the pressed button's callback.
   *
   * @param show A `vscode.window.show*Message` overload; it returns the pressed item itself,
   * so duplicate labels stay distinct.
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
   * Adapts increment-style `vscode.Progress` to absolute completion fractions.
   *
   * A fraction below an earlier report leaves the bar where it is; the message still shows.
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
