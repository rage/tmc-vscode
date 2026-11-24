import { createHash } from "node:crypto"
import * as fs from "node:fs"
import { basename, join, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"

import type { ElectronApplication } from "@playwright/test"
import { _electron as electron } from "@playwright/test"
import { downloadAndUnzipVSCode, runVSCodeCommand } from "@vscode/test-electron"

import { productionApi, VSCODE_TEST_VERSION } from "../../config"
import { getLangsCLIForPlatform, getPlatform } from "../../src/utilities/env"
import { BASE_USER_SETTINGS, extensionGlobalStorage, launchArgs, mockBackendEnv } from "../fixtures"

const rootPath = resolve(__dirname, "..", "..")

/** Holds the downloaded 3.x release and the VSIX `bin/packageUpgradeVsix.sh` builds. */
const UPGRADE_CACHE_DIR = join(rootPath, ".vscode-test", "upgrade-e2e")

/** The checkout packaged as an update to {@link LEGACY_RELEASE}, by `bin/packageUpgradeVsix.sh`. */
export const NEXT_VSIX = join(UPGRADE_CACHE_DIR, "next.vsix")

/** `origin/rollback-3.5.x`, packaged by `bin/packageRollbackVsix.sh`. */
export const ROLLBACK_VSIX = join(UPGRADE_CACHE_DIR, "rollback.vsix")

const EXTENSION_ID = "moocfi.test-my-code"

/** The last 3.x release, as Open VSX serves it to the users who upgrade from it. */
const LEGACY_RELEASE = {
  // bin/packageUpgradeVsix.sh reads this line.
  version: "3.5.5",
  vsixUrl: "https://open-vsx.org/api/moocfi/test-my-code/3.5.5/file/moocfi.test-my-code-3.5.5.vsix",
  vsixSha256: "f8d8ce67575d69f08fae8d4b032123bc905b209acbbb39d7517821b58a1f23e7",
  langsVersion: "0.39.9",
}

const LANGS_DOWNLOAD_URL = JSON.parse(productionApi.__TMC_LANGS_DL_URL__) as string
export const PINNED_LANGS_VERSION = JSON.parse(productionApi.__TMC_LANGS_VERSION__) as string

/** One VS Code profile that extensions are installed into and launched from, across versions. */
export interface Profile {
  userDataDir: string
  extensionsDir: string
  /** TMC_LANGS_CONFIG_DIR. */
  configDir: string
  /** TMC_LANGS_DEFAULT_PROJECTS_DIR. */
  projectsDir: string
}

const sha256Of = (file: string): string =>
  createHash("sha256").update(fs.readFileSync(file)).digest("hex")

async function download(url: string, destination: string): Promise<void> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Could not download ${url}: ${response.status} ${response.statusText}`)
  }
  // Renamed into place so an interrupted download is not mistaken for a cached one.
  const partial = `${destination}.partial`
  fs.writeFileSync(partial, Buffer.from(await response.arrayBuffer()))
  fs.renameSync(partial, destination)
}

let verifiedLegacyVsix: Promise<string> | undefined

/** The 3.5.5 VSIX, downloaded once into {@link UPGRADE_CACHE_DIR} and verified once per run. */
export function legacyVsix(): Promise<string> {
  verifiedLegacyVsix ??= downloadLegacyVsix()
  return verifiedLegacyVsix
}

async function downloadLegacyVsix(): Promise<string> {
  const vsix = join(UPGRADE_CACHE_DIR, `test-my-code-${LEGACY_RELEASE.version}.vsix`)
  fs.mkdirSync(UPGRADE_CACHE_DIR, { recursive: true })
  if (!fs.existsSync(vsix)) {
    await download(LEGACY_RELEASE.vsixUrl, vsix)
  }
  const digest = sha256Of(vsix)
  if (digest !== LEGACY_RELEASE.vsixSha256) {
    fs.rmSync(vsix)
    throw new Error(`${LEGACY_RELEASE.vsixUrl} hashes to ${digest}, not the pinned checksum`)
  }
  return vsix
}

/** The tmc-langs 0.39.9 build 3.5.5 runs here, and its checksum file, downloaded once. */
async function legacyLangsCli(): Promise<string[]> {
  const binary = getLangsCLIForPlatform(getPlatform(), LEGACY_RELEASE.langsVersion)
  const files = [binary, `${binary}.sha256`]
  for (const file of files) {
    const cached = join(UPGRADE_CACHE_DIR, file)
    if (!fs.existsSync(cached)) {
      await download(LANGS_DOWNLOAD_URL + file, cached)
    }
  }
  return files.map((file) => join(UPGRADE_CACHE_DIR, file))
}

/** The pinned CLI the mock backend serves, which `bin/useLocalLangs.bash` may have replaced. */
function pinnedLangsCli(): string[] {
  const binary = getLangsCLIForPlatform(getPlatform(), PINNED_LANGS_VERSION)
  return [binary, `${binary}.sha256`].map((file) => join(rootPath, "backend", "cli", file))
}

/**
 * Puts both versions' CLIs where the extension looks before downloading one. A production build
 * would otherwise fetch it from download.mooc.fi on every start, and 4.x deletes 0.39.9's.
 */
async function seedLangsClis(profile: Profile): Promise<void> {
  const cliFolder = join(extensionGlobalStorage(profile.userDataDir), "cli")
  fs.mkdirSync(cliFolder, { recursive: true })
  for (const file of [...(await legacyLangsCli()), ...pinnedLangsCli()]) {
    const seeded = join(cliFolder, basename(file))
    fs.copyFileSync(file, seeded)
    fs.chmodSync(seeded, 0o755)
  }
}

/** A fresh profile in `parentDir`, with the settings every run starts with. */
export function createProfile(parentDir: string): Profile {
  const profile = {
    userDataDir: join(parentDir, "user-data"),
    extensionsDir: join(parentDir, "extensions"),
    configDir: join(parentDir, "config"),
    projectsDir: join(parentDir, "projects"),
  }
  for (const dir of Object.values(profile)) {
    fs.mkdirSync(dir)
  }
  fs.mkdirSync(join(profile.userDataDir, "User"))
  fs.writeFileSync(
    join(profile.userDataDir, "User", "settings.json"),
    JSON.stringify({
      ...BASE_USER_SETTINGS,
      // The installed extension is published; VS Code would replace it with the latest release.
      "extensions.autoCheckUpdates": false,
      "extensions.autoUpdate": false,
    }),
  )
  return profile
}

// runVSCodeCommand runs the Windows CLI through a shell, which splits unquoted paths. A flag's
// value alone is quoted: runVSCodeCommand appends its own default dirs unless an argument starts
// with `--extensions-dir=` or `--user-data-dir=`.
const quote = (arg: string): string => (process.platform === "win32" ? `"${arg}"` : arg)

/** Installs `vsix` into `profile` as `code --install-extension` does, replacing any other version. */
export async function installVsix(profile: Profile, vsix: string): Promise<void> {
  await runVSCodeCommand(
    [
      "--install-extension",
      quote(vsix),
      "--force",
      `--extensions-dir=${quote(profile.extensionsDir)}`,
      `--user-data-dir=${quote(profile.userDataDir)}`,
    ],
    { version: VSCODE_TEST_VERSION },
  )
}

/** Starts VS Code on `profile` with whichever version of the extension it has installed. */
export async function launchVsCode(profile: Profile): Promise<ElectronApplication> {
  await seedLangsClis(profile)
  return electron.launch({
    executablePath: await downloadAndUnzipVSCode(VSCODE_TEST_VERSION),
    args: launchArgs(profile.userDataDir, false, { extensionsDir: profile.extensionsDir }),
    env: mockBackendEnv(profile.configDir, profile.projectsDir),
  })
}

/**
 * The extension's global state as VS Code persisted it. Read it only after VS Code has closed:
 * a running VS Code writes it lazily.
 */
export function readGlobalState(profile: Profile): Record<string, unknown> {
  const database = new DatabaseSync(
    join(profile.userDataDir, "User", "globalStorage", "state.vscdb"),
    { readOnly: true },
  )
  try {
    const row = database.prepare("SELECT value FROM ItemTable WHERE key = ?").get(EXTENSION_ID)
    return row === undefined ? {} : (JSON.parse(String(row.value)) as Record<string, unknown>)
  } finally {
    database.close()
  }
}
