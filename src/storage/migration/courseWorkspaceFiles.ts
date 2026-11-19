import * as path from "path"

import * as fs from "fs-extra"
import * as jsonc from "jsonc-parser"

import { Logger } from "../../utilities/logger"

/**
 * Removes the extension's own settings, which earlier versions copied into the course workspace
 * files in `workspaceFileFolder`, so that the User settings apply again. Edits each file in place,
 * keeping its comments and every other setting; a file that is not valid JSON is left as it is.
 */
export async function unpinExtensionSettings(workspaceFileFolder: string): Promise<void> {
  const entries = await fs.readdir(workspaceFileFolder).catch(() => undefined)
  if (!entries) {
    return
  }
  for (const entry of entries.filter((x) => x.endsWith(".code-workspace"))) {
    await unpinFile(path.join(workspaceFileFolder, entry))
  }
}

async function unpinFile(workspaceFile: string): Promise<void> {
  const text = await fs.readFile(workspaceFile, "utf-8")
  const errors: jsonc.ParseError[] = []
  const tree = jsonc.parseTree(text, errors, { allowTrailingComma: true })
  if (!tree || errors.length > 0) {
    Logger.warn(`Left ${workspaceFile} as it is: it is not valid JSON.`)
    return
  }
  const pinned = UNPINNED_SETTINGS.filter((key) =>
    jsonc.findNodeAtLocation(tree, ["settings", key]),
  )
  if (pinned.length === 0) {
    return
  }
  let unpinned = text
  for (const key of pinned) {
    const edits = jsonc.modify(unpinned, ["settings", key], undefined, {
      formattingOptions: { insertSpaces: true, tabSize: 2 },
    })
    unpinned = jsonc.applyEdits(unpinned, edits)
  }
  await fs.writeFile(workspaceFile, unpinned)
  Logger.info(`Removed the extension's settings from ${workspaceFile}.`)
}

/** Settings earlier versions copied into course workspace files, outranking the User settings. */
const UNPINNED_SETTINGS = [
  "testMyCode.downloadOldSubmission",
  "testMyCode.hideMetaFiles",
  "testMyCode.updateExercisesAutomatically",
]
