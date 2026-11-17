import * as fs from "fs"
import * as path from "path"

import * as vscode from "vscode"

import { Logger } from "../utilities/logger"

/** The VS Code extension that runs and debugs the exercises of one language. */
export interface LanguageExtension {
  /** The language as students know it, e.g. "Python". */
  language: string
  extensionId: string
  /** VS Code's language id of the language's source files. */
  languageId: string
  /** Whether the exercise in `folder` is in this language, judged by its files. */
  isUsedBy: (folder: string) => boolean
}

const JAVA_BUILD_FILES = ["pom.xml", "build.xml", "build.gradle", "build.gradle.kts"]

export const PYTHON_EXTENSION_ID = "ms-python.python"

export const LANGUAGE_EXTENSIONS: readonly LanguageExtension[] = [
  {
    language: "Python",
    extensionId: PYTHON_EXTENSION_ID,
    languageId: "python",
    isUsedBy: (folder) => hasFileEndingWith(path.join(folder, "src"), ".py"),
  },
  {
    language: "Java",
    // What earlier versions of this extension recommended for Java exercises.
    extensionId: "vscjava.vscode-java-pack",
    languageId: "java",
    isUsedBy: (folder) => JAVA_BUILD_FILES.some((file) => fs.existsSync(path.join(folder, file))),
  },
]

/** What a course home notice and the first-open toast say of a missing extension. */
export function installSentence({ language }: LanguageExtension): string {
  return `Install the ${language} extension to run and debug your code.`
}

export function isInstalled({ extensionId }: LanguageExtension): boolean {
  return vscode.extensions.getExtension(extensionId) !== undefined
}

export function languageExtensionById(extensionId: string): LanguageExtension | undefined {
  return LANGUAGE_EXTENSIONS.find((extension) => extension.extensionId === extensionId)
}

export function languageExtensionForLanguageId(languageId: string): LanguageExtension | undefined {
  return LANGUAGE_EXTENSIONS.find((extension) => extension.languageId === languageId)
}

// An exercise keeps its language, so only a match is remembered: a folder read mid-download
// would otherwise be taken as no language for good.
const languagesByFolder = new Map<string, LanguageExtension[]>()

function languagesOf(folder: string): LanguageExtension[] {
  const known = languagesByFolder.get(folder)
  if (known) {
    return known
  }
  const used = LANGUAGE_EXTENSIONS.filter((extension) => extension.isUsedBy(folder))
  if (used.length > 0) {
    languagesByFolder.set(folder, used)
  }
  return used
}

/**
 * The extensions the exercises in `folders` need and this VS Code lacks, in
 * {@link LANGUAGE_EXTENSIONS} order.
 */
export function missingLanguageExtensions(folders: readonly string[]): LanguageExtension[] {
  const needed = new Set(folders.flatMap((folder) => languagesOf(folder)))
  return LANGUAGE_EXTENSIONS.filter((extension) => needed.has(extension) && !isInstalled(extension))
}

/** Installs `extension` from the marketplace VS Code uses. Never rejects. */
export async function installLanguageExtension(extension: LanguageExtension): Promise<void> {
  try {
    await vscode.commands.executeCommand(
      "workbench.extensions.installExtension",
      extension.extensionId,
    )
  } catch (e) {
    Logger.warn(`Could not install ${extension.extensionId}.`, e)
  }
}

function hasFileEndingWith(folder: string, suffix: string): boolean {
  try {
    return fs.readdirSync(folder).some((file) => file.endsWith(suffix))
  } catch {
    return false
  }
}
