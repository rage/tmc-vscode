import * as os from "os"
import * as path from "path"

import * as fs from "fs-extra"
import * as vscode from "vscode"

import { CLIENT_NAME, EXTENSION_VERSION, TMC_LANGS_CONFIG_DIR } from "../config/constants"
import Storage from "../storage"
import { v0, v1, v3 } from "../storage/data"
import { COURSES_VIEW_ID } from "../ui/treeview/treeview"
import { isSamePath, Logger } from "../utilities"
import { WALKTHROUGH } from "../window/walkthrough"

/** Global state keys that hold data from an older storage version, which only a full activation migrates. */
const LEGACY_DATA_KEYS = [
  v0.USER_DATA_KEY,
  v0.EXERCISE_DATA_KEY,
  v0.EXTENSION_SETTINGS_KEY,
  v1.USER_DATA_KEY,
  v1.EXTENSION_SETTINGS_KEY,
  v3.PENDING_EXERCISE_MIGRATION_KEY,
]

/** The CLI's credential files: legacy `credentials.json` and the per-host `credentials_mooc_<host>.json`. */
const CREDENTIALS_FILE = /^credentials(_mooc(_.+)?)?\.json$/

/** Where the course workspace files live, under the extension's global storage. */
export function workspaceFileFolderOf(context: vscode.ExtensionContext): string {
  return path.join(context.globalStorageUri.fsPath, "workspaces")
}

/**
 * The folder `tmc-langs-cli` keeps its settings and logins in, or `undefined` where it has none.
 *
 * `configuredDir` is what `Langs` passes as `TMC_LANGS_CONFIG_DIR`; without it this mirrors the
 * CLI's own fallback, `get_tmc_dir` in tmc-langs' `config.rs` on the `dirs` crate's `config_dir`.
 */
export function cliConfigFolder(
  configuredDir: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = os.homedir(),
): string | undefined {
  let base: string | undefined
  if (configuredDir) {
    base = configuredDir
  } else if (platform === "win32") {
    base = env.APPDATA
  } else if (platform === "darwin") {
    base = path.join(home, "Library", "Application Support")
  } else {
    const xdg = env.XDG_CONFIG_HOME
    base = xdg && path.isAbsolute(xdg) ? xdg : path.join(home, ".config")
  }
  return base && path.join(base, `tmc-${CLIENT_NAME}`)
}

/** Whether the CLI has a login stored in `folder`, valid or not. */
export async function hasStoredLogin(folder: string | undefined): Promise<boolean> {
  if (!folder) {
    return false
  }
  try {
    return (await fs.readdir(folder)).some((name) => CREDENTIALS_FILE.test(name))
  } catch {
    return false
  }
}

/**
 * Whether this window can start TestMyCode light: it is not a course workspace, and
 * TestMyCode holds no course, legacy data or login yet.
 */
export async function canDeferActivation(context: vscode.ExtensionContext): Promise<boolean> {
  const workspaceFile = vscode.workspace.workspaceFile
  if (
    workspaceFile &&
    isSamePath(path.dirname(workspaceFile.fsPath), workspaceFileFolderOf(context))
  ) {
    return false
  }
  const storedKeys = new Set(context.globalState.keys())
  if (LEGACY_DATA_KEYS.some((key) => storedKeys.has(key))) {
    return false
  }
  try {
    const userData = new Storage(context).getUserData()
    if (userData && userData.courses.length + userData.mooc_courses.length > 0) {
      return false
    }
  } catch {
    // Only a full activation can report unreadable courses.
    return false
  }
  return !(await hasStoredLogin(
    cliConfigFolder(process.env.TMC_LANGS_CONFIG_DIR ?? TMC_LANGS_CONFIG_DIR),
  ))
}

/**
 * Starts TestMyCode light: opens the walkthrough on a first install and leaves the rest to
 * `activateFully`, which runs once the Courses view is shown or one of TestMyCode's commands runs.
 */
export async function deferActivation(
  context: vscode.ExtensionContext,
  activateFully: () => Promise<void>,
): Promise<void> {
  const standIns: vscode.Disposable[] = []
  let fullActivation: Promise<void> | undefined
  const activateOnce = (): Promise<void> => {
    if (!fullActivation) {
      // The full activation registers the real commands and view under the same ids.
      vscode.Disposable.from(...standIns).dispose()
      fullActivation = activateFully()
    }
    return fullActivation
  }

  const commandIds = (
    (context.extension.packageJSON as { contributes?: { commands?: { command: string }[] } })
      .contributes?.commands ?? []
  ).map(({ command }) => command)
  for (const id of commandIds) {
    standIns.push(
      vscode.commands.registerCommand(id, async (...args: unknown[]) => {
        await activateOnce()
        return vscode.commands.executeCommand(id, ...args)
      }),
    )
  }
  // VS Code asks for the children only while the view is shown.
  standIns.push(
    vscode.window.createTreeView(COURSES_VIEW_ID, {
      treeDataProvider: {
        getChildren: (): never[] => {
          // Not before VS Code has its answer: activating disposes this view.
          setTimeout(() => void activateOnce())
          return []
        },
        getTreeItem: (item: never): vscode.TreeItem => item,
      },
    }),
  )
  context.subscriptions.push({ dispose: () => vscode.Disposable.from(...standIns).dispose() })

  try {
    const storage = new Storage(context)
    if (storage.getSessionState()?.extensionVersion === undefined) {
      await storage.updateSessionState({ extensionVersion: EXTENSION_VERSION })
      await vscode.commands.executeCommand("workbench.action.openWalkthrough", WALKTHROUGH, false)
    }
  } catch (e) {
    Logger.warn("Could not open the walkthrough", e)
  }
}
