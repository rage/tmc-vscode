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

const allPlatforms: SupportedPlatform[] = [
  "linux32",
  "linux64",
  "linuxarm",
  "linuxarm64",
  "macos64",
  "macosarm64",
  "windows32",
  "windows64",
]

/** Filenames of every published build, for the release-time existence check. */
export function getAllLangsCLIs(version: string): string[] {
  return allPlatforms.map((x) => getLangsCLIForPlatform(x, version))
}

/** The build target for the running process, or `"unsupported"`. */
export function getPlatform(): Platform {
  const platform = process.platform
  const arch = process.arch
  if (platform === "linux") {
    if (arch === "x64") {
      return "linux64"
    } else if (arch === "arm64") {
      return "linuxarm64"
    } else if (arch === "arm") {
      return "linuxarm"
    } else if (arch === "ia32") {
      return "linux32"
    }
    return "unsupported"
  } else if (platform === "win32") {
    // Windows on ARM runs the i686 build through x86 emulation.
    return arch === "x64" ? "windows64" : "windows32"
  } else if (platform === "darwin") {
    if (arch === "arm64") {
      return "macosarm64"
    } else if (arch === "x64") {
      return "macos64"
    }
    return "unsupported"
  }
  return "unsupported"
}

/**
 * Filename of the tmc-langs-cli build for `platform`.
 *
 * Throws on `"unsupported"`: there is no binary to fall back to, and guessing one
 * costs the user a 51 MB download that cannot run. Narrow the platform first.
 */
export function getLangsCLIForPlatform(platform: Platform, version: string): string {
  switch (platform) {
    case "linux32":
      return `tmc-langs-cli-i686-unknown-linux-gnu-${version}`
    case "linux64":
      return `tmc-langs-cli-x86_64-unknown-linux-gnu-${version}`
    case "linuxarm":
      return `tmc-langs-cli-armv7-unknown-linux-gnueabihf-${version}`
    case "linuxarm64":
      return `tmc-langs-cli-aarch64-unknown-linux-gnu-${version}`
    case "macosarm64":
      return `tmc-langs-cli-aarch64-apple-darwin-${version}`
    case "macos64":
      return `tmc-langs-cli-x86_64-apple-darwin-${version}`
    case "windows32":
      return `tmc-langs-cli-i686-pc-windows-msvc-${version}.exe`
    case "windows64":
      return `tmc-langs-cli-x86_64-pc-windows-msvc-${version}.exe`
    default:
      throw new Error(`No tmc-langs-cli build for ${process.platform}/${process.arch}`)
  }
}
