import * as path from "path"

import * as fs from "fs-extra"
import * as tmp from "tmp"
import { vi } from "vitest"
import type * as vscode from "vscode"

import { CorruptStoredDataError, FileSystemError } from "../../errors"
import { resourceInitialization } from "../../init/resources"
import Storage from "../../storage"
import { v3 } from "../../storage/data"
import { Logger, LogLevel } from "../../utilities"
import * as userData from "../fixtures/userData"
import { createMockContext } from "../mocks/vscode"

// jest-mock-vscode ships no `env` namespace, and `Resources` reads `env.appName`.
vi.mock("vscode", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  env: { appName: "Visual Studio Code" },
}))

suite("resourceInitialization", function () {
  let context: vscode.ExtensionContext
  let storage: Storage
  let temporaryRoot: string

  beforeEach(function () {
    Logger.configure(LogLevel.None)
    context = createMockContext()
    storage = new Storage(context)
    temporaryRoot = tmp.dirSync().name
  })

  test("creates the workspace files for every stored course", async function () {
    await context.globalState.update(v3.USER_DATA_KEY, userData.v3_0_0)
    const workspaceFileFolder = path.join(temporaryRoot, "workspaces")

    const result = await resourceInitialization(
      context,
      storage,
      "3.0.0",
      undefined,
      workspaceFileFolder,
    )

    expect(result.ok).toBe(true)
    expect(fs.existsSync(path.join(workspaceFileFolder, ".tmc"))).toBe(true)
  })

  // The whole degraded mode -- the tree view's recovery entries, the
  // InitializationErrorHelp panel -- hangs off this `Err`. A throw here instead skips
  // every one of them and aborts activation.
  test("errs instead of throwing when the workspace folder cannot be created", async function () {
    const blocked = path.join(temporaryRoot, "workspaces")
    fs.writeFileSync(blocked, "a regular file where the folder belongs")

    const result = await resourceInitialization(context, storage, "3.0.0", undefined, blocked)

    expect(result.err).toBe(true)
    expect(result.val).toBeInstanceOf(FileSystemError)
  })

  test("errs instead of throwing when the projects directory cannot be created", async function () {
    const blocked = path.join(temporaryRoot, "projects")
    fs.writeFileSync(blocked, "a regular file where the folder belongs")

    const result = await resourceInitialization(
      context,
      storage,
      "3.0.0",
      path.join(blocked, "exercises"),
      path.join(temporaryRoot, "workspaces"),
    )

    expect(result.err).toBe(true)
    expect(result.val).toBeInstanceOf(FileSystemError)
  })

  test("errs, keeping the diagnosis, when the stored course data cannot be read", async function () {
    await context.globalState.update(v3.USER_DATA_KEY, { courses: "not a list of courses" })

    const result = await resourceInitialization(
      context,
      storage,
      "3.0.0",
      undefined,
      path.join(temporaryRoot, "workspaces"),
    )

    expect(result.err).toBe(true)
    expect(result.val).toBeInstanceOf(CorruptStoredDataError)
  })
})
