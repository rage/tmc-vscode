import * as fs from "fs"
import * as os from "os"
import * as path from "path"

import { onTestFinished } from "vitest"

import { removeStoredLogins } from "../uninstall"

suite("removeStoredLogins", function () {
  test("removes every stored login and nothing else", function () {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "tmc-uninstall-"))
    onTestFinished(() => fs.rmSync(folder, { recursive: true, force: true }))
    for (const name of ["credentials.json", "credentials_mooc_host.json", "config.toml"]) {
      fs.writeFileSync(path.join(folder, name), "{}")
    }

    expect(removeStoredLogins(folder).toSorted()).toEqual([
      "credentials.json",
      "credentials_mooc_host.json",
    ])
    expect(fs.readdirSync(folder)).toEqual(["config.toml"])
  })

  test("does nothing without a folder", function () {
    expect(removeStoredLogins(undefined)).toEqual([])
    expect(removeStoredLogins(path.join(os.tmpdir(), "no-such-tmc-folder"))).toEqual([])
  })
})
