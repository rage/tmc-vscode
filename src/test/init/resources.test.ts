import * as path from "path"

import * as fs from "fs-extra"
import * as jsonc from "jsonc-parser"
import * as tmp from "tmp"
import { vi } from "vitest"
import type * as vscode from "vscode"

import { workspaceFileName } from "../../config/constants"
import { FileSystemError } from "../../errors"
import { resourceInitialization } from "../../init/resources"
import Storage from "../../storage"
import { v3 } from "../../storage/data"
import type { MoocLocalCourseData } from "../../storage/data"
import { Logger, LogLevel } from "../../utilities"
import { moocCourseData } from "../fixtures/courses"
import * as userData from "../fixtures/userData"
import { createMockContext } from "../mocks/vscode"

const moocCourse: MoocLocalCourseData = moocCourseData({
  id: "8bd5a0d6-8ba0-4b2a-a2e0-0dd1ba7f2af5",
  name: "a-mooc-course",
  title: "A courses.mooc.fi course",
})

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

    const result = await resourceInitialization(storage, undefined, workspaceFileFolder)

    expect(result.ok).toBe(true)
    expect(fs.existsSync(path.join(workspaceFileFolder, ".tmc"))).toBe(true)
    expect(
      fs.existsSync(path.join(workspaceFileFolder, workspaceFileName("test-python-course", "tmc"))),
    ).toBe(true)
  })

  test("creates the workspace files for a stored mooc course", async function () {
    await context.globalState.update(v3.USER_DATA_KEY, {
      courses: [],
      mooc_courses: [moocCourse],
    })
    const workspaceFileFolder = path.join(temporaryRoot, "workspaces")

    const result = await resourceInitialization(storage, undefined, workspaceFileFolder)

    expect(result.ok).toBe(true)
    expect(
      fs.existsSync(path.join(workspaceFileFolder, workspaceFileName("a-mooc-course", "mooc"))),
    ).toBe(true)
  })

  // The whole degraded mode -- the tree view's recovery entries, the
  // InitializationErrorHelp panel -- hangs off this `Err`. A throw here instead skips
  // every one of them and aborts activation.
  test("errs instead of throwing when the workspace folder cannot be created", async function () {
    const blocked = path.join(temporaryRoot, "workspaces")
    fs.writeFileSync(blocked, "a regular file where the folder belongs")

    const result = await resourceInitialization(storage, undefined, blocked)

    expect(result.err).toBe(true)
    expect(result.val).toBeInstanceOf(FileSystemError)
  })

  test("errs instead of throwing when the projects directory cannot be created", async function () {
    const blocked = path.join(temporaryRoot, "projects")
    fs.writeFileSync(blocked, "a regular file where the folder belongs")

    const result = await resourceInitialization(
      storage,
      path.join(blocked, "exercises"),
      path.join(temporaryRoot, "workspaces"),
    )

    expect(result.err).toBe(true)
    expect(result.val).toBeInstanceOf(FileSystemError)
  })

  // Unreadable courses are `UserData`'s to report; the workspace files do not need them.
  test("succeeds when the stored course data cannot be read", async function () {
    await context.globalState.update(v3.USER_DATA_KEY, { courses: "not a list of courses" })
    const workspaceFileFolder = path.join(temporaryRoot, "workspaces")

    const result = await resourceInitialization(storage, undefined, workspaceFileFolder)

    expect(result.ok).toBe(true)
    expect(fs.existsSync(path.join(workspaceFileFolder, ".tmc"))).toBe(true)
  })

  // Earlier versions copied them there, where they outranked the User settings.
  suite("with the extension's settings in a course workspace file", function () {
    const pinnedText = `{
  // the student's note
  "folders": [{ "path": ".tmc" }, { "path": "/exercises/hello" }],
  "settings": {
    "chat.disableAIFeatures": true,
    "testMyCode.downloadOldSubmission": false,
    "testMyCode.hideMetaFiles": true,
    "testMyCode.updateExercisesAutomatically": true
  },
  "extensions": { "recommendations": ["ms-python.python"] }
}`
    let workspaceFileFolder: string

    beforeEach(function () {
      workspaceFileFolder = path.join(temporaryRoot, "workspaces")
      fs.mkdirSync(workspaceFileFolder, { recursive: true })
    })

    test("removes them in place, keeping everything else", async function () {
      const file = path.join(workspaceFileFolder, workspaceFileName("a-mooc-course", "mooc"))
      fs.writeFileSync(file, pinnedText)

      const result = await resourceInitialization(storage, undefined, workspaceFileFolder)

      expect(result.ok).toBe(true)
      const unpinned = fs.readFileSync(file, "utf-8")
      expect(unpinned).toContain("// the student's note")
      expect(jsonc.parse(unpinned)).toEqual({
        folders: [{ path: ".tmc" }, { path: "/exercises/hello" }],
        settings: { "chat.disableAIFeatures": true },
        extensions: { recommendations: ["ms-python.python"] },
      })
    })

    test("leaves a file it cannot read as JSON as it is", async function () {
      const broken = path.join(workspaceFileFolder, workspaceFileName("broken", "tmc"))
      fs.writeFileSync(broken, "{ not json")

      const result = await resourceInitialization(storage, undefined, workspaceFileFolder)

      expect(result.ok).toBe(true)
      expect(fs.readFileSync(broken, "utf-8")).toBe("{ not json")
    })
  })
})
