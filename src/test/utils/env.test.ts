import { getAllLangsCLIs, getLangsCLIForPlatform, getPlatform } from "../../utilities/env"

const version = "0.0.0-test"

/** Runs `body` with `process.platform`/`process.arch` faked, then restores both. */
function withHost(platform: string, arch: string, body: () => void): void {
  const original = { platform: process.platform, arch: process.arch }
  Object.defineProperty(process, "platform", { value: platform, configurable: true })
  Object.defineProperty(process, "arch", { value: arch, configurable: true })
  try {
    body()
  } finally {
    Object.defineProperty(process, "platform", { value: original.platform, configurable: true })
    Object.defineProperty(process, "arch", { value: original.arch, configurable: true })
  }
}

/** Runs `body` with the diagnostic report claiming the given glibc runtime version. */
function withGlibc(glibcVersionRuntime: string | undefined, body: () => void): void {
  const original = process.report
  Object.defineProperty(process, "report", {
    value: { getReport: () => ({ header: { glibcVersionRuntime } }) },
    configurable: true,
  })
  try {
    body()
  } finally {
    Object.defineProperty(process, "report", { value: original, configurable: true })
  }
}

suite("getAllLangsCLIs", function () {
  test("enumerates every published build exactly once", function () {
    const clis = getAllLangsCLIs(version)
    // A duplicate means some platform resolves to another one's build, which is
    // invisible to the release-time existence check.
    expect(new Set(clis).size).toBe(clis.length)
    expect(clis).toEqual([
      `tmc-langs-cli-i686-unknown-linux-gnu-${version}`,
      `tmc-langs-cli-x86_64-unknown-linux-gnu-${version}`,
      `tmc-langs-cli-armv7-unknown-linux-gnueabihf-${version}`,
      `tmc-langs-cli-aarch64-unknown-linux-gnu-${version}`,
      `tmc-langs-cli-x86_64-apple-darwin-${version}`,
      `tmc-langs-cli-aarch64-apple-darwin-${version}`,
      `tmc-langs-cli-i686-pc-windows-msvc-${version}.exe`,
      `tmc-langs-cli-x86_64-pc-windows-msvc-${version}.exe`,
      `tmc-langs-cli-x86_64-unknown-linux-musl-${version}`,
    ])
  })
})

suite("getPlatform", function () {
  test("resolves the hosts tmc-langs publishes builds for", function () {
    // The runner's own report has no glibc version off Linux, which reads as musl.
    withGlibc("2.35", () => {
      withHost("linux", "x64", () => expect(getPlatform()).toBe("linux64"))
      withHost("linux", "ia32", () => expect(getPlatform()).toBe("linux32"))
      withHost("linux", "arm64", () => expect(getPlatform()).toBe("linuxarm64"))
      withHost("linux", "arm", () => expect(getPlatform()).toBe("linuxarm"))
    })
    withHost("darwin", "x64", () => expect(getPlatform()).toBe("macos64"))
    withHost("darwin", "arm64", () => expect(getPlatform()).toBe("macosarm64"))
    withHost("win32", "x64", () => expect(getPlatform()).toBe("windows64"))
    withHost("win32", "arm64", () => expect(getPlatform()).toBe("windows32"))
  })

  test("picks the musl build on a Linux without a glibc runtime", function () {
    withGlibc(undefined, () => {
      withHost("linux", "x64", () => expect(getPlatform()).toBe("linuxmusl64"))
      withHost("linux", "arm64", () => expect(getPlatform()).toBe("linuxarm64"))
      withHost("darwin", "x64", () => expect(getPlatform()).toBe("macos64"))
    })
    withGlibc("2.35", () => {
      withHost("linux", "x64", () => expect(getPlatform()).toBe("linux64"))
    })
  })

  test("assumes glibc when the diagnostic report cannot be read", function () {
    const original = process.report
    Object.defineProperty(process, "report", { value: undefined, configurable: true })
    try {
      withHost("linux", "x64", () => expect(getPlatform()).toBe("linux64"))
    } finally {
      Object.defineProperty(process, "report", { value: original, configurable: true })
    }
  })

  test("reports a host with no build as unsupported instead of guessing one", function () {
    withHost("linux", "ppc64", () => expect(getPlatform()).toBe("unsupported"))
    withHost("linux", "s390x", () => expect(getPlatform()).toBe("unsupported"))
    withHost("darwin", "ppc", () => expect(getPlatform()).toBe("unsupported"))
    withHost("freebsd", "x64", () => expect(getPlatform()).toBe("unsupported"))
    withHost("sunos", "x64", () => expect(getPlatform()).toBe("unsupported"))
  })
})

suite("getLangsCLIForPlatform", function () {
  test("throws for an unsupported host rather than returning a binary that cannot run", function () {
    withHost("sunos", "x64", () => {
      expect(() => getLangsCLIForPlatform("unsupported", version)).toThrow("sunos/x64")
    })
  })
})
