import * as path from "path"

import * as fs from "fs-extra"
import * as tmp from "tmp"
import { vi } from "vitest"
import * as vscode from "vscode"

import { workspaceFileName } from "../../config/constants"
import {
  canDeferActivation,
  cliConfigFolder,
  hasStoredLogin,
  workspaceFileFolderOf,
} from "../../init/deferredActivation"
import { USER_DATA_KEY, v0 } from "../../storage/data"
import { tmcCourseData } from "../fixtures/courses"
import { createMockContext } from "../mocks/vscode"

function openWorkspaceFile(file: string | undefined): void {
  Object.defineProperty(vscode.workspace, "workspaceFile", {
    value: file && vscode.Uri.file(file),
    configurable: true,
  })
}

suite("whether activation can be deferred", function () {
  let configDir: string

  beforeEach(function () {
    configDir = tmp.dirSync().name
    vi.stubEnv("TMC_LANGS_CONFIG_DIR", configDir)
    openWorkspaceFile(undefined)
  })

  afterEach(function () {
    vi.unstubAllEnvs()
    openWorkspaceFile(undefined)
  })

  test("yes in a plain window with nothing stored", async function () {
    expect(await canDeferActivation(createMockContext())).toBe(true)
  })

  test("yes with stored user data that holds no course", async function () {
    const context = createMockContext()
    await context.globalState.update(USER_DATA_KEY, { courses: [], mooc_courses: [] })

    expect(await canDeferActivation(context)).toBe(true)
  })

  test("yes in a workspace of the student's own", async function () {
    openWorkspaceFile(path.join(tmp.dirSync().name, "mine.code-workspace"))

    expect(await canDeferActivation(createMockContext())).toBe(true)
  })

  test("no in a course workspace", async function () {
    const context = createMockContext()
    openWorkspaceFile(
      path.join(workspaceFileFolderOf(context), workspaceFileName("a-course", "mooc")),
    )

    expect(await canDeferActivation(context)).toBe(false)
  })

  test("no once a course is added", async function () {
    const context = createMockContext()
    await context.globalState.update(USER_DATA_KEY, { courses: [tmcCourseData], mooc_courses: [] })

    expect(await canDeferActivation(context)).toBe(false)
  })

  test("no with stored courses it cannot read", async function () {
    const context = createMockContext()
    await context.globalState.update(USER_DATA_KEY, { courses: "not an array" })

    expect(await canDeferActivation(context)).toBe(false)
  })

  test("no with data from an older version to migrate", async function () {
    const context = createMockContext()
    await context.globalState.update(v0.USER_DATA_KEY, { courses: [] })

    expect(await canDeferActivation(context)).toBe(false)
  })

  test("no with a stored login", async function () {
    const clientDir = path.join(configDir, "tmc-vscode_plugin")
    fs.ensureDirSync(clientDir)
    fs.writeFileSync(path.join(clientDir, "credentials_mooc_lab-042.json"), "{}")

    expect(await canDeferActivation(createMockContext())).toBe(false)
  })
})

suite("the CLI's config folder", function () {
  test("is the configured one when set", function () {
    expect(cliConfigFolder("/conf", {}, "linux", "/home/s")).toBe(
      path.join("/conf", "tmc-vscode_plugin"),
    )
  })

  test("follows an absolute XDG_CONFIG_HOME on Linux", function () {
    expect(cliConfigFolder(undefined, { XDG_CONFIG_HOME: "/xdg" }, "linux", "/home/s")).toBe(
      path.join("/xdg", "tmc-vscode_plugin"),
    )
    expect(cliConfigFolder(undefined, { XDG_CONFIG_HOME: "rel" }, "linux", "/home/s")).toBe(
      path.join("/home/s", ".config", "tmc-vscode_plugin"),
    )
  })

  test("is under Application Support on macOS", function () {
    expect(cliConfigFolder(undefined, {}, "darwin", "/Users/s")).toBe(
      path.join("/Users/s", "Library", "Application Support", "tmc-vscode_plugin"),
    )
  })

  test("is under APPDATA on Windows, and none without it", function () {
    expect(cliConfigFolder(undefined, { APPDATA: "/appdata" }, "win32", "/home/s")).toBe(
      path.join("/appdata", "tmc-vscode_plugin"),
    )
    expect(cliConfigFolder(undefined, {}, "win32", "/home/s")).toBeUndefined()
  })
})

suite("a stored login", function () {
  test("is any of the CLI's credential files", async function () {
    for (const name of ["credentials.json", "credentials_mooc.json", "credentials_mooc_h.json"]) {
      const folder = tmp.dirSync().name
      fs.writeFileSync(path.join(folder, name), "{}")
      expect(await hasStoredLogin(folder)).toBe(true)
    }
  })

  test("is not the CLI's settings, nor a missing folder", async function () {
    const folder = tmp.dirSync().name
    fs.writeFileSync(path.join(folder, "config.toml"), "")

    expect(await hasStoredLogin(folder)).toBe(false)
    expect(await hasStoredLogin(path.join(folder, "missing"))).toBe(false)
  })
})
