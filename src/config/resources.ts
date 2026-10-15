import * as path from "path"

import * as vscode from "vscode"

import type { BackendKind } from "../../shared/lib"
import { WORKSPACE_FILE_FOLDER_NAME, workspaceFileName } from "./constants"

export enum EditorKind {
  Code = 0,
  VSCodium = 1,
}

/** Where the exercises and the course workspaces live on disk. */
export default class Resources {
  public readonly editorKind: EditorKind
  private _projectsDirectory: string

  public constructor(projectsDirectory: string) {
    this.editorKind = vscode.env.appName === "VSCodium" ? EditorKind.VSCodium : EditorKind.Code
    this._projectsDirectory = projectsDirectory
  }

  /** The exercises folder, which also holds the course workspace files. */
  public get projectsDirectory(): string {
    return this._projectsDirectory
  }

  public set projectsDirectory(directory: string) {
    this._projectsDirectory = directory
  }

  public get workspaceFileFolder(): string {
    return path.join(this._projectsDirectory, WORKSPACE_FILE_FOLDER_NAME)
  }

  /** Every course workspace's first folder: the exercises folder itself. */
  public get workspaceRootFolder(): vscode.Uri {
    return vscode.Uri.file(this._projectsDirectory)
  }

  public getWorkspaceFilePath(courseName: string, backend: BackendKind): string {
    return path.join(this.workspaceFileFolder, workspaceFileName(courseName, backend))
  }
}
