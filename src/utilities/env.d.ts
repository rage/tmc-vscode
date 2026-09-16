/** A platform/arch pair tmc-langs-cli publishes a build for. */
export type SupportedPlatform =
  | "linux32"
  | "linux64"
  | "linuxarm"
  | "linuxarm64"
  | "macos64"
  | "macosarm64"
  | "windows32"
  | "windows64"

/** A build target, or `"unsupported"` when no build exists for the running process. */
export type Platform = SupportedPlatform | "unsupported"

/** Filenames of every published build, for the release-time existence check. */
export function getAllLangsCLIs(version: string): string[]

/**
 * Filename of the tmc-langs-cli build for `platform`.
 *
 * Throws on `"unsupported"`: there is no binary to fall back to, and guessing one
 * costs the user a 51 MB download that cannot run. Narrow the platform first.
 */
export function getLangsCLIForPlatform(platform: Platform, version: string): string

/** The build target for the running process, or `"unsupported"`. */
export function getPlatform(): Platform
