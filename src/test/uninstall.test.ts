import * as fs from "fs"
import * as os from "os"
import * as path from "path"

import { onTestFinished, vi } from "vitest"

import { CLIENT_NAME } from "../config/constants"
import { removeStoredLogins } from "../uninstall"

/** A config dir as `Langs` passes it, and the CLI's folder inside it. */
function configDir(): { base: string; folder: string } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "tmc-uninstall-"))
  onTestFinished(() => fs.rmSync(base, { recursive: true, force: true }))
  const folder = path.join(base, `tmc-${CLIENT_NAME}`)
  fs.mkdirSync(folder)
  return { base, folder }
}

suite("removeStoredLogins", function () {
  test("removes every stored login and nothing else", function () {
    const { base, folder } = configDir()
    for (const name of ["credentials.json", "credentials_mooc_host.json", "config.toml"]) {
      fs.writeFileSync(path.join(folder, name), "{}")
    }

    expect(removeStoredLogins(base).toSorted()).toEqual([
      "credentials.json",
      "credentials_mooc_host.json",
    ])
    expect(fs.readdirSync(folder)).toEqual(["config.toml"])
  })

  test.skipIf(process.platform === "win32")(
    "logs out with the CLI first, in the CLI's config dir",
    function () {
      const { base, folder } = configDir()
      fs.writeFileSync(path.join(folder, "credentials_mooc_host.json"), "{}")
      const cli = path.join(base, "fake-cli")
      fs.writeFileSync(
        cli,
        '#!/bin/sh\necho "$HTTPS_PROXY $TMC_LANGS_CONFIG_DIR $*" > "$TMC_LANGS_CONFIG_DIR/ran"\n' +
          'rm "$TMC_LANGS_CONFIG_DIR/tmc-' +
          CLIENT_NAME +
          '/credentials_mooc_host.json"\n',
        { mode: 0o755 },
      )

      vi.stubEnv("HTTPS_PROXY", undefined)
      vi.stubEnv("https_proxy", undefined)
      onTestFinished(() => {
        vi.unstubAllEnvs()
      })
      const httpProxy = { proxy: "http://proxy:3128", noProxy: [] }

      expect(removeStoredLogins(base, { cliPath: cli, httpProxy })).toEqual([])
      expect(fs.readFileSync(path.join(base, "ran"), "utf-8")).toMatch(
        new RegExp(`^http://proxy:3128 ${base} mooc --client-name ${CLIENT_NAME} .* logout\\n$`),
      )
    },
  )

  test.skipIf(process.platform === "win32")(
    "keeps other computers' logins after the CLI logged out",
    function () {
      const { base, folder } = configDir()
      for (const name of ["credentials.json", "credentials_mooc_other-host.json"]) {
        fs.writeFileSync(path.join(folder, name), "{}")
      }
      const cli = path.join(base, "fake-cli")
      fs.writeFileSync(cli, "#!/bin/sh\nexit 0\n", { mode: 0o755 })

      expect(removeStoredLogins(base, { cliPath: cli })).toEqual(["credentials.json"])
      expect(fs.readdirSync(folder)).toEqual(["credentials_mooc_other-host.json"])
    },
  )

  test("deletes the logins when the CLI is gone", function () {
    const { base, folder } = configDir()
    fs.writeFileSync(path.join(folder, "credentials_mooc_host.json"), "{}")

    expect(removeStoredLogins(base, { cliPath: path.join(base, "no-such-cli") })).toEqual([
      "credentials_mooc_host.json",
    ])
  })

  test("does nothing without a folder", function () {
    expect(removeStoredLogins(path.join(os.tmpdir(), "no-such-tmc-folder"))).toEqual([])
  })
})
