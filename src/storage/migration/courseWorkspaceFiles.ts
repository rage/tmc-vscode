import * as path from "path"

import * as fs from "fs-extra"
import * as jsonc from "jsonc-parser"

import { WORKSPACE_SETTINGS } from "../../config/constants"
import type Resources from "../../config/resources"
import { Logger } from "../../utilities/logger"

/**
 * Moves the course workspace files out of `legacyFolder`, the extension's global storage, into
 * the exercises folder, where one Workspace Trust decision covers them and every exercise.
 *
 * Each file keeps its settings, such as the AI restriction and extension recommendations; its
 * folder list starts over from the exercises folder, as the extension rebuilds the rest from the
 * stored open exercises. A file already in the new place wins. A legacy file is deleted once
 * copied, unless `openWorkspaceFile` names it: VS Code still has that one open, and the next
 * activation, in the new place, deletes it.
 */
export async function migrateCourseWorkspaceFiles(
  legacyFolder: string,
  resources: Resources,
  openWorkspaceFile: string | undefined,
): Promise<void> {
  const entries = await fs.readdir(legacyFolder).catch(() => undefined)
  if (!entries) {
    return
  }
  let isLegacyFileKept = false
  for (const entry of entries.filter((x) => x.endsWith(".code-workspace"))) {
    const legacyFile = path.join(legacyFolder, entry)
    const migrated = await migrateFile(legacyFile, path.join(resources.workspaceFileFolder, entry))
    if (migrated && legacyFile !== openWorkspaceFile) {
      await fs.remove(legacyFile)
    } else {
      isLegacyFileKept = true
    }
  }
  if (!isLegacyFileKept) {
    await fs.remove(legacyFolder)
    Logger.info(`Moved the course workspace files from ${legacyFolder}.`)
  }
}

/** @returns Whether `target` now stands in for `legacyFile`. */
async function migrateFile(legacyFile: string, target: string): Promise<boolean> {
  if (await fs.pathExists(target)) {
    return true
  }
  const text = await fs.readFile(legacyFile, "utf-8")
  const errors: jsonc.ParseError[] = []
  jsonc.parse(text, errors, { allowTrailingComma: true })
  if (errors.length > 0) {
    Logger.warn(`Left ${legacyFile} in place: it is not valid JSON.`)
    return false
  }
  const edits = jsonc.modify(text, ["folders"], WORKSPACE_SETTINGS.folders, {
    formattingOptions: { insertSpaces: true, tabSize: 2 },
  })
  await fs.ensureDir(path.dirname(target))
  await fs.writeFile(target, jsonc.applyEdits(text, edits), { flag: "wx" })
  return true
}
