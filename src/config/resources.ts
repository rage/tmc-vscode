import * as path from "path"

import * as vscode from "vscode"

import {
  WORKSPACE_ROOT_FILE_NAME,
  WORKSPACE_ROOT_FOLDER_NAME,
  workspaceFileName,
} from "./constants"

export enum EditorKind {
  Code = 0,
  VSCodium = 1,
}

export default class Resources {
  public readonly editorKind: EditorKind
  private _projectsDirectory: string | undefined

  public constructor(
    public readonly cssFolder: string,
    public readonly extensionVersion: string,
    public readonly htmlFolder: string,
    public readonly mediaFolder: string,
    public readonly workspaceFileFolder: string,
    projectsDirectory: string | undefined,
  ) {
    this.editorKind = vscode.env.appName === "VSCodium" ? EditorKind.VSCodium : EditorKind.Code
    this._projectsDirectory = projectsDirectory
  }

  public get projectsDirectory(): string | undefined {
    return this._projectsDirectory
  }

  public set projectsDirectory(directory: string) {
    this._projectsDirectory = directory
  }

  public get workspaceRootFolder(): vscode.Uri {
    return vscode.Uri.file(path.join(this.workspaceFileFolder, WORKSPACE_ROOT_FOLDER_NAME))
  }

  public get workspaceRootFile(): vscode.Uri {
    return vscode.Uri.file(
      path.join(this.workspaceFileFolder, WORKSPACE_ROOT_FOLDER_NAME, WORKSPACE_ROOT_FILE_NAME),
    )
  }

  public getWorkspaceFilePath(courseName: string, backend: "tmc" | "mooc"): string {
    return path.join(this.workspaceFileFolder, workspaceFileName(courseName, backend))
  }
}
