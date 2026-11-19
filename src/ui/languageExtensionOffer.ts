import * as vscode from "vscode"

import type Dialog from "../api/dialog"
import type { LanguageExtension } from "../api/languageExtensions"
import {
  installLanguageExtension,
  installSentence,
  isInstalled,
  languageExtensionForLanguageId,
} from "../api/languageExtensions"
import type WorkspaceManager from "../api/workspaceManager"
import { Logger } from "../utilities"

/** `globalState` key: the extension ids already offered, until each is installed. */
const OFFERED_KEY = "languageExtensionsOffered"

/**
 * Offers to install a language's extension, which gives an exercise its Run and Debug buttons,
 * the first time an exercise file of that language opens without it: once per language, until
 * the extension is installed.
 */
export class LanguageExtensionOffer implements vscode.Disposable {
  private readonly _disposables: vscode.Disposable[]
  // One at a time, so two files opened together cannot both find the offer due.
  private _considered: Promise<void> = Promise.resolve()

  /** @param openDocuments Those already open, which no open event announces. */
  public constructor(
    private readonly _dialog: Pick<Dialog, "notification">,
    private readonly _workspaceManager: Pick<WorkspaceManager, "getExerciseContaining">,
    private readonly _globalState: vscode.Memento,
    openDocuments: readonly vscode.TextDocument[] = vscode.workspace.textDocuments,
    onDidOpenTextDocument: vscode.Event<vscode.TextDocument> = vscode.workspace
      .onDidOpenTextDocument,
  ) {
    this._disposables = [onDidOpenTextDocument((document) => void this.consider(document))]
    openDocuments.forEach((document) => void this.consider(document))
  }

  /** Offers the extension `document` needs, if it is an exercise's and the offer is due. */
  public consider(document: vscode.TextDocument): Promise<void> {
    this._considered = this._considered
      .then(() => this._consider(document))
      .catch((e) => Logger.warn("Could not offer a language extension.", e))
    return this._considered
  }

  public dispose(): void {
    this._disposables.forEach((disposable) => disposable.dispose())
  }

  private async _consider(document: vscode.TextDocument): Promise<void> {
    const extension = languageExtensionForLanguageId(document.languageId)
    if (!extension || !this._workspaceManager.getExerciseContaining(document.uri)) {
      return
    }
    const offered = this._globalState.get<string[]>(OFFERED_KEY) ?? []
    if (isInstalled(extension)) {
      if (offered.includes(extension.extensionId)) {
        await this._globalState.update(
          OFFERED_KEY,
          offered.filter((id) => id !== extension.extensionId),
        )
      }
      return
    }
    if (offered.includes(extension.extensionId)) {
      return
    }
    await this._globalState.update(OFFERED_KEY, [...offered, extension.extensionId])
    this._offer(extension)
  }

  private _offer(extension: LanguageExtension): void {
    void this._dialog.notification(installSentence(extension), [
      "Install",
      (): void => void installLanguageExtension(extension),
    ])
  }
}
