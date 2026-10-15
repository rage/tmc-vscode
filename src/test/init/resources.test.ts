import * as path from "path"

import * as fs from "fs-extra"
import * as jsonc from "jsonc-parser"
import * as tmp from "tmp"
import { vi } from "vitest"
import * as vscode from "vscode"

import {
  WORKSPACE_FILE_FOLDER_NAME,
  WORKSPACE_ROOT_FILE_NAME,
  WORKSPACE_SETTINGS,
  workspaceFileName,
} from "../../config/constants"
import { FileSystemError, InitializationError } from "../../errors"
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
  let projectsDirectory: string
  let legacyFolder: string

  beforeEach(function () {
    Logger.configure(LogLevel.None)
    context = createMockContext()
    storage = new Storage(context)
    temporaryRoot = tmp.dirSync().name
    projectsDirectory = path.join(temporaryRoot, "projects")
    legacyFolder = path.join(temporaryRoot, "globalStorage", "workspaces")
  })

  function workspaceFile(name: string, backend: "tmc" | "mooc"): string {
    return path.join(
      projectsDirectory,
      WORKSPACE_FILE_FOLDER_NAME,
      workspaceFileName(name, backend),
    )
  }

  test("creates the workspace files for every stored course in the exercises folder", async function () {
    await context.globalState.update(v3.USER_DATA_KEY, userData.v3_0_0)

    const result = await resourceInitialization(storage, projectsDirectory, legacyFolder)

    expect(result.ok).toBe(true)
    expect(fs.existsSync(path.join(projectsDirectory, WORKSPACE_ROOT_FILE_NAME))).toBe(true)
    expect(fs.existsSync(workspaceFile("test-python-course", "tmc"))).toBe(true)
  })

  test("creates the workspace files for a stored mooc course", async function () {
    await context.globalState.update(v3.USER_DATA_KEY, {
      courses: [],
      mooc_courses: [moocCourse],
    })

    const result = await resourceInitialization(storage, projectsDirectory, legacyFolder)

    expect(result.ok).toBe(true)
    expect(fs.existsSync(workspaceFile("a-mooc-course", "mooc"))).toBe(true)
  })

  test("errs without an exercises folder to keep the workspace files in", async function () {
    const result = await resourceInitialization(storage, undefined, legacyFolder)

    expect(result.err).toBe(true)
    expect(result.val).toBeInstanceOf(InitializationError)
  })

  // The whole degraded mode -- the tree view's recovery entries, the
  // InitializationErrorHelp panel -- hangs off this `Err`. A throw here instead skips
  // every one of them and aborts activation.
  test("errs instead of throwing when the projects directory cannot be created", async function () {
    const blocked = path.join(temporaryRoot, "projects")
    fs.writeFileSync(blocked, "a regular file where the folder belongs")

    const result = await resourceInitialization(
      storage,
      path.join(blocked, "exercises"),
      legacyFolder,
    )

    expect(result.err).toBe(true)
    expect(result.val).toBeInstanceOf(FileSystemError)
  })

  // Unreadable courses are `UserData`'s to report; the workspace files do not need them.
  test("succeeds when the stored course data cannot be read", async function () {
    await context.globalState.update(v3.USER_DATA_KEY, { courses: "not a list of courses" })

    const result = await resourceInitialization(storage, projectsDirectory, legacyFolder)

    expect(result.ok).toBe(true)
    expect(fs.existsSync(path.join(projectsDirectory, WORKSPACE_ROOT_FILE_NAME))).toBe(true)
  })

  suite("with course workspace files where earlier versions kept them", function () {
    const legacyText = `{
  // the student's note
  "folders": [{ "path": ".tmc" }, { "path": "/old/exercises/hello" }],
  "settings": {
    "chat.disableAIFeatures": true,
    "testMyCode.downloadOldSubmission": false,
    "testMyCode.hideMetaFiles": true,
    "testMyCode.updateExercisesAutomatically": true
  },
  "extensions": { "recommendations": ["ms-python.python"] }
}`

    beforeEach(function () {
      fs.mkdirSync(path.join(legacyFolder, ".tmc"), { recursive: true })
      fs.writeFileSync(path.join(legacyFolder, ".tmc", WORKSPACE_ROOT_FILE_NAME), "old readme")
      fs.writeFileSync(
        path.join(legacyFolder, workspaceFileName("a-mooc-course", "mooc")),
        legacyText,
      )
    })

    // Earlier versions copied the extension's settings there, out of the student's reach.
    test("moves them into the exercises folder, keeping their settings but the extension's", async function () {
      const result = await resourceInitialization(storage, projectsDirectory, legacyFolder)

      expect(result.ok).toBe(true)
      const moved = fs.readFileSync(workspaceFile("a-mooc-course", "mooc"), "utf-8")
      expect(moved).toContain("// the student's note")
      expect(jsonc.parse(moved)).toEqual({
        folders: WORKSPACE_SETTINGS.folders,
        settings: { "chat.disableAIFeatures": true },
        extensions: { recommendations: ["ms-python.python"] },
      })
      expect(fs.existsSync(legacyFolder)).toBe(false)
    })

    test("keeps the one VS Code has open until a later start", async function () {
      const open = path.join(legacyFolder, workspaceFileName("a-mooc-course", "mooc"))
      const workspace = vscode.workspace as unknown as { workspaceFile: vscode.Uri | undefined }
      Object.defineProperty(workspace, "workspaceFile", {
        value: vscode.Uri.file(open),
        configurable: true,
      })
      try {
        await resourceInitialization(storage, projectsDirectory, legacyFolder)
      } finally {
        Object.defineProperty(workspace, "workspaceFile", { value: undefined, configurable: true })
      }

      expect(fs.existsSync(open)).toBe(true)
      expect(fs.existsSync(workspaceFile("a-mooc-course", "mooc"))).toBe(true)

      await resourceInitialization(storage, projectsDirectory, legacyFolder)
      expect(fs.existsSync(legacyFolder)).toBe(false)
    })

    test("leaves a file already in the exercises folder as it is", async function () {
      fs.mkdirSync(path.dirname(workspaceFile("a-mooc-course", "mooc")), { recursive: true })
      fs.writeFileSync(workspaceFile("a-mooc-course", "mooc"), '{"folders":[]}')

      await resourceInitialization(storage, projectsDirectory, legacyFolder)

      expect(fs.readFileSync(workspaceFile("a-mooc-course", "mooc"), "utf-8")).toBe(
        '{"folders":[]}',
      )
      expect(fs.existsSync(legacyFolder)).toBe(false)
    })

    test("leaves a file it cannot read as JSON where it is", async function () {
      const broken = path.join(legacyFolder, workspaceFileName("broken", "tmc"))
      fs.writeFileSync(broken, "{ not json")

      const result = await resourceInitialization(storage, projectsDirectory, legacyFolder)

      expect(result.ok).toBe(true)
      expect(fs.readFileSync(broken, "utf-8")).toBe("{ not json")
      expect(fs.existsSync(workspaceFile("a-mooc-course", "mooc"))).toBe(true)
    })
  })
})
