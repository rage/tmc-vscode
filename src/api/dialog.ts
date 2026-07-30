import * as vscode from "vscode"

import { Logger } from "../utilities"

type Item<T> = [label: string, value: T, description?: string]

type NotificationButton = [label: string, callback: () => void]

export interface PercentProgress {
  message?: string | undefined
  percent: number
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
      items = items.concat([Dialog._logsButton])
    }

    return vscode.window
      .showErrorMessage(`TestMyCode: ${notification}`, ...items.map((item) => item[0]))
      .then((selection) => {
        items.find((item) => item[0] === selection)?.[1]()
      })
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
    return vscode.window
      .showInformationMessage(`TestMyCode: ${message}`, ...items.map((item) => item[0]))
      .then((selection) => {
        items.find((item) => item[0] === selection)?.[1]()
      })
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
      progress: vscode.Progress<PercentProgress>,
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
        const percentageProgress = this._incrementPercentageWrapper(progress)

        return task(percentageProgress, token)
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
    return vscode.window
      .showWarningMessage(`TestMyCode: ${message}`, ...items.map((item) => item[0]))
      .then((selection) => {
        items.find((item) => item[0] === selection)?.[1]()
      })
  }

  /**
   * Wraps increment-style `vscode.Progress` with a version that allows reporting simple
   * percentages instead. This is mostly useful when using `vscode.window.withProgress`.
   */
  private _incrementPercentageWrapper(
    progress: vscode.Progress<{ message?: string; increment: number }>,
  ): vscode.Progress<PercentProgress> {
    let peak = 0
    const report: (value: PercentProgress) => void = ({ message, percent }) => {
      const increment = 100 * (percent - peak)
      if (increment > 0) {
        progress.report({ increment, ...(message !== undefined ? { message } : {}) })
        peak = percent
      }
    }

    return { report }
  }
}
