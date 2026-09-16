import * as fs from "fs"
import * as os from "os"
import * as path from "path"

import { Err, Ok } from "ts-results"
import type { Mock } from "vitest"
import { vi } from "vitest"
import * as vscode from "vscode"

import type { PersistClosedExercises, WorkspaceExercise } from "../../api/workspaceManager"
import WorkspaceManager, {
  ensureCourseWorkspaceFile,
  ensureWorkspaceRootFile,
  ExerciseStatus,
} from "../../api/workspaceManager"
import {
  HIDE_META_FILES,
  WATCHER_EXCLUDE,
  WORKSPACE_ROOT_FILE_NAME,
  WORKSPACE_ROOT_FILE_TEXT,
  WORKSPACE_ROOT_FOLDER_NAME,
  WORKSPACE_SETTINGS,
  workspaceFileName,
} from "../../config/constants"
import Resources from "../../config/resources"
import { Logger } from "../../utilities"

// `Resources` reads `vscode.env.appName` to tell Code from VSCodium, and the
// mock ships no `env`.
const vscodeModule = vscode as unknown as {
  env: { appName: string }
  extensions: { getExtension: (id: string) => vscode.Extension<unknown> | undefined }
}
Object.defineProperty(vscodeModule, "env", {
  value: { appName: "Visual Studio Code" },
  configurable: true,
})

/** Replaces `vscode.extensions`, which the mock does not ship at all. */
function stubExtensions(getExtension: (id: string) => vscode.Extension<unknown> | undefined): void {
  Object.defineProperty(vscodeModule, "extensions", {
    value: { getExtension },
    configurable: true,
  })
}

const WORKSPACE_FILE_FOLDER = "/tmc/workspaces"
const PROJECTS_DIRECTORY = "/tmc/projects"

interface WorkspaceStubs {
  workspaceFile: vscode.Uri | undefined
  name: string | undefined
  workspaceFolders: vscode.WorkspaceFolder[] | undefined
  onDidChangeWorkspaceFolders: () => vscode.Disposable
  onDidOpenTextDocument: () => vscode.Disposable
  getConfiguration: (section?: string, scope?: unknown) => vscode.WorkspaceConfiguration
  updateWorkspaceFolders: (
    start: number,
    deleteCount: number,
    ...folders: { uri: vscode.Uri }[]
  ) => boolean
}

/**
 * Replaces one `vscode.workspace` member for the duration of a test. The mock
 * exposes the workspace state as prototype getters, which an own data property
 * shadows.
 */
function stubWorkspace<K extends keyof WorkspaceStubs>(key: K, value: WorkspaceStubs[K]): void {
  Object.defineProperty(vscode.workspace, key, { value, configurable: true, writable: true })
}

let resources: Resources
let rootFolder: vscode.WorkspaceFolder
let updateWorkspaceFolders: Mock<WorkspaceStubs["updateWorkspaceFolders"]>

function exercise(
  backend: "tmc" | "mooc",
  courseSlug: string,
  exerciseSlug: string,
  status: ExerciseStatus,
): WorkspaceExercise {
  return {
    backend,
    courseSlug,
    exerciseSlug,
    status,
    uri: vscode.Uri.file(path.join(PROJECTS_DIRECTORY, backend, courseSlug, exerciseSlug)),
  }
}

function folderOf(uri: vscode.Uri, name: string): vscode.WorkspaceFolder {
  return { uri, name, index: 0 }
}

const persist: PersistClosedExercises = async () => Ok.EMPTY

/**
 * Opens `fileName` as the window's workspace file, together with the display
 * name VS Code derives from it.
 */
function openWorkspaceFile(fileName: string): void {
  stubWorkspace("workspaceFile", vscode.Uri.file(path.join(WORKSPACE_FILE_FOLDER, fileName)))
  stubWorkspace("name", `${path.basename(fileName, ".code-workspace")} (Workspace)`)
}

type UpdateSetting = (section: string, value: unknown, target?: unknown) => Promise<void>

/**
 * A `WorkspaceConfiguration` backed by `stored`, the values the `.code-workspace`
 * already holds per section, that records writes so a test can assert what would
 * land in the file.
 */
function configurationStub(
  update: Mock<UpdateSetting>,
  stored: (section: string) => unknown = () => undefined,
): vscode.WorkspaceConfiguration {
  return {
    get: <T>(_section: string, defaultValue?: T) => defaultValue,
    has: () => false,
    inspect: (section: string) => ({ key: section, workspaceValue: stored(section) }),
    update,
  } as unknown as vscode.WorkspaceConfiguration
}

suite("WorkspaceManager class", function () {
  beforeEach(function () {
    resources = new Resources(
      "/css",
      "1.0.0",
      "/html",
      "/media",
      WORKSPACE_FILE_FOLDER,
      PROJECTS_DIRECTORY,
    )
    rootFolder = folderOf(resources.workspaceRootFolder, WORKSPACE_ROOT_FOLDER_NAME)
    updateWorkspaceFolders = vi.fn<WorkspaceStubs["updateWorkspaceFolders"]>(() => true)

    stubWorkspace("workspaceFile", undefined)
    stubWorkspace("name", undefined)
    stubWorkspace("workspaceFolders", [rootFolder])
    stubWorkspace(
      "onDidChangeWorkspaceFolders",
      vi.fn(() => ({ dispose: vi.fn() })),
    )
    stubWorkspace(
      "onDidOpenTextDocument",
      vi.fn(() => ({ dispose: vi.fn() })),
    )
    stubWorkspace("updateWorkspaceFolders", updateWorkspaceFolders)
  })

  suite("active course workspace", function () {
    test("reads the course and backend of a tmc workspace file", function () {
      openWorkspaceFile(workspaceFileName("test-python-course", "tmc"))
      const manager = new WorkspaceManager(resources)
      expect(manager.activeCourse).toBe("test-python-course")
      expect(manager.activeCourseBackend).toBe("tmc")
    })

    test("reads the course and backend of a mooc workspace file", function () {
      openWorkspaceFile(workspaceFileName("test-python-course", "mooc"))
      const manager = new WorkspaceManager(resources)
      expect(manager.activeCourse).toBe("test-python-course")
      expect(manager.activeCourseBackend).toBe("mooc")
    })

    test("treats an untagged workspace file as a tmc course", function () {
      openWorkspaceFile("test-python-course.code-workspace")
      const manager = new WorkspaceManager(resources)
      expect(manager.activeCourse).toBe("test-python-course")
      expect(manager.activeCourseBackend).toBe("tmc")
    })

    test("reads a course slug containing a space", function () {
      openWorkspaceFile(workspaceFileName("my python course", "mooc"))
      const manager = new WorkspaceManager(resources)
      expect(manager.activeCourse).toBe("my python course")
      expect(manager.activeCourseBackend).toBe("mooc")
    })

    test("has no active course when the open workspace is not a course workspace", function () {
      stubWorkspace("workspaceFile", vscode.Uri.file("/elsewhere/some-project.code-workspace"))
      stubWorkspace("name", "some-project (Workspace)")
      const manager = new WorkspaceManager(resources)
      expect(manager.activeCourse).toBeUndefined()
      expect(manager.activeCourseBackend).toBeUndefined()
    })

    test("keeps a spaced-slug course's open exercises in its workspace", async function () {
      const open = exercise("mooc", "my python course", "hello_world", ExerciseStatus.Open)
      openWorkspaceFile(workspaceFileName("my python course", "mooc"))
      stubWorkspace("workspaceFolders", [rootFolder, folderOf(open.uri, open.exerciseSlug)])

      const manager = new WorkspaceManager(resources)
      const result = await manager.setExercises([open])

      expect(result.ok).toBe(true)
      expect(updateWorkspaceFolders).not.toHaveBeenCalled()
    })
  })

  suite("exercise lookup by path", function () {
    const helloWorld = exercise("tmc", "test-python-course", "hello_world", ExerciseStatus.Open)
    let manager: WorkspaceManager

    beforeEach(function () {
      manager = new WorkspaceManager(resources, [helloWorld])
    })

    test("finds the exercise by its own folder", function () {
      expect(manager.getExerciseByPath(helloWorld.uri)?.exerciseSlug).toBe("hello_world")
      expect(manager.getExerciseContaining(helloWorld.uri)?.exerciseSlug).toBe("hello_world")
    })

    test("finds the exercise a file inside it belongs to only by containment", function () {
      const file = vscode.Uri.file(path.join(helloWorld.uri.fsPath, "src", "hello.py"))
      expect(manager.getExerciseContaining(file)?.exerciseSlug).toBe("hello_world")
      expect(manager.getExerciseByPath(file)).toBeUndefined()
    })

    test("does not match a sibling folder the exercise name prefixes", function () {
      const sibling = vscode.Uri.file(`${helloWorld.uri.fsPath}_2`)
      expect(manager.getExerciseContaining(sibling)).toBeUndefined()
    })

    test("does not match the course folder above the exercise", function () {
      const courseFolder = vscode.Uri.file(path.dirname(helloWorld.uri.fsPath))
      expect(manager.getExerciseContaining(courseFolder)).toBeUndefined()
    })

    test("terminates on a path outside the exercise tree", function () {
      expect(manager.getExerciseContaining(vscode.Uri.file("/elsewhere/notes.txt"))).toBeUndefined()
    })

    test("forgets an exercise dropped from a later exercise list", async function () {
      await manager.setExercises([])
      expect(manager.getExerciseByPath(helloWorld.uri)).toBeUndefined()
      expect(manager.getExerciseContaining(helloWorld.uri)).toBeUndefined()
    })
  })

  suite("opening and closing exercises", function () {
    const courseSlug = "test-python-course"
    let open: WorkspaceExercise
    let closed: WorkspaceExercise
    let manager: WorkspaceManager

    beforeEach(function () {
      open = exercise("tmc", courseSlug, "hello_world", ExerciseStatus.Open)
      closed = exercise("tmc", courseSlug, "part02-01_greeting", ExerciseStatus.Closed)
      openWorkspaceFile(workspaceFileName(courseSlug, "tmc"))
      stubWorkspace("workspaceFolders", [rootFolder, folderOf(open.uri, open.exerciseSlug)])
      manager = new WorkspaceManager(resources, [open, closed])
    })

    test("records the whole closed set, not only the exercises the caller named", async function () {
      const record = vi.fn<PersistClosedExercises>(async () => Ok.EMPTY)

      await manager.closeCourseExercises("tmc", courseSlug, [open.exerciseSlug], record)

      expect(record).toHaveBeenCalledExactlyOnceWith(["hello_world", "part02-01_greeting"])
    })

    test("records the closed set before the workspace shows the change", async function () {
      let workspaceWritesBeforeRecording = -1
      await manager.closeCourseExercises("tmc", courseSlug, [open.exerciseSlug], async () => {
        workspaceWritesBeforeRecording = updateWorkspaceFolders.mock.calls.length
        return Ok.EMPTY
      })

      expect(workspaceWritesBeforeRecording).toBe(0)
      expect(updateWorkspaceFolders).toHaveBeenCalledOnce()
    })

    test("changes nothing the user can see when the closed set cannot be recorded", async function () {
      const result = await manager.closeCourseExercises(
        "tmc",
        courseSlug,
        [open.exerciseSlug],
        async () => Err(new Error("settings are read-only")),
      )

      expect(result.err).toBe(true)
      expect(open.status).toBe(ExerciseStatus.Open)
      expect(updateWorkspaceFolders).not.toHaveBeenCalled()
    })

    test("drops the reopened exercise from the recorded closed set", async function () {
      const record = vi.fn<PersistClosedExercises>(async () => Ok.EMPTY)

      await manager.openCourseExercises("tmc", courseSlug, [closed.exerciseSlug], record)

      expect(record).toHaveBeenCalledExactlyOnceWith([])
      expect(closed.status).toBe(ExerciseStatus.Open)
    })
  })

  suite("workspace settings integrity", function () {
    const alreadyCorrect: Record<string, unknown> = {
      "files.exclude": HIDE_META_FILES,
      "files.watcherExclude": WATCHER_EXCLUDE,
      "explorer.decorations.colors": false,
      "explorer.decorations.badges": true,
      "problems.decorations.enabled": false,
    }
    let update: Mock<UpdateSetting>

    beforeEach(function () {
      update = vi.fn<UpdateSetting>(async () => undefined)
      openWorkspaceFile(workspaceFileName("test-python-course", "tmc"))
    })

    function sectionsWritten(): string[] {
      return update.mock.calls.map(([section]) => section)
    }

    test("keeps verifying when the extension's own record is missing", async function () {
      stubExtensions(() => undefined)
      stubWorkspace("getConfiguration", () => configurationStub(update))

      await new WorkspaceManager(resources).verifyWorkspaceSettingsIntegrity()

      expect(sectionsWritten()).toEqual(
        expect.arrayContaining([
          "files.watcherExclude",
          "explorer.decorations.colors",
          "problems.decorations.enabled",
        ]),
      )
    })

    test("merges a section's stored workspace value, not the effective config", async function () {
      stubExtensions(() => undefined)
      stubWorkspace("getConfiguration", () =>
        configurationStub(update, () => ({ "**/legacy": true })),
      )

      await new WorkspaceManager(resources).verifyWorkspaceSettingsIntegrity()

      const written = update.mock.calls.find(([section]) => section === "files.exclude")?.[1]
      expect(written).toEqual({ "**/legacy": true, ...HIDE_META_FILES })
    })

    // Every write is a configuration-change broadcast every installed extension
    // has to handle, and this pass runs on each activation.
    test("writes nothing when the workspace file already holds the settings", async function () {
      stubExtensions(() => undefined)
      stubWorkspace("getConfiguration", () =>
        configurationStub(update, (section) => alreadyCorrect[section]),
      )

      await new WorkspaceManager(resources).verifyWorkspaceSettingsIntegrity()

      expect(update).not.toHaveBeenCalled()
    })

    test("writes only the section that drifted", async function () {
      stubExtensions(() => undefined)
      stubWorkspace("getConfiguration", () =>
        configurationStub(update, (section) =>
          section === "problems.decorations.enabled" ? true : alreadyCorrect[section],
        ),
      )

      await new WorkspaceManager(resources).verifyWorkspaceSettingsIntegrity()

      expect(update).toHaveBeenCalledExactlyOnceWith(
        "problems.decorations.enabled",
        false,
        vscode.ConfigurationTarget.Workspace,
      )
    })
  })

  suite("addWorkspaceRecommendation", function () {
    const courseSlug = "test-python-course"
    let workspaceFileFolder: string
    let workspaceFile: string
    let manager: WorkspaceManager

    beforeEach(function () {
      workspaceFileFolder = fs.mkdtempSync(path.join(os.tmpdir(), "workspace-manager-"))
      resources = new Resources(
        "/css",
        "1.0.0",
        "/html",
        "/media",
        workspaceFileFolder,
        PROJECTS_DIRECTORY,
      )
      workspaceFile = resources.getWorkspaceFilePath(courseSlug, "tmc")
      manager = new WorkspaceManager(resources)
    })

    afterEach(function () {
      fs.rmSync(workspaceFileFolder, { recursive: true, force: true })
    })

    test("warns instead of throwing when the workspace file is unreadable", function () {
      const warn = vi.spyOn(Logger, "warn").mockImplementation(() => undefined)

      expect(() =>
        manager.addWorkspaceRecommendation(courseSlug, "tmc", ["ms-python.python"]),
      ).not.toThrow()
      expect(warn).toHaveBeenCalledOnce()

      warn.mockRestore()
    })

    test("leaves the file untouched when every extension is already recommended", function () {
      const contents = JSON.stringify(
        { folders: [], extensions: { recommendations: ["ms-python.python"] } },
        null,
        2,
      )
      fs.writeFileSync(workspaceFile, contents)

      manager.addWorkspaceRecommendation(courseSlug, "tmc", ["ms-python.python"])

      expect(fs.readFileSync(workspaceFile, "utf-8")).toBe(contents)
    })

    test("merges a new extension into the recommendations already there", function () {
      fs.writeFileSync(
        workspaceFile,
        JSON.stringify({ folders: [], extensions: { recommendations: ["ikuyadeu.r"] } }),
      )

      manager.addWorkspaceRecommendation(courseSlug, "tmc", ["ms-python.python"])

      const written = fs.readFileSync(workspaceFile, "utf-8")
      expect(JSON.parse(written)).toEqual({
        folders: [],
        extensions: { recommendations: ["ikuyadeu.r", "ms-python.python"] },
      })
      expect(written).toContain("\n")
    })

    test("recommends into a workspace file that lists none yet", function () {
      fs.writeFileSync(workspaceFile, JSON.stringify({ folders: [] }))

      manager.addWorkspaceRecommendation(courseSlug, "tmc", ["ms-python.python"])

      const written = JSON.parse(fs.readFileSync(workspaceFile, "utf-8"))
      expect(written.extensions.recommendations).toEqual(["ms-python.python"])
    })

    test("creates a course's workspace file where its resources put it", async function () {
      await manager.createWorkspaceFile(courseSlug, "tmc")

      expect(JSON.parse(fs.readFileSync(workspaceFile, "utf-8"))).toEqual(WORKSPACE_SETTINGS)
    })

    test("leaves a course's existing workspace file untouched", async function () {
      fs.writeFileSync(workspaceFile, '{"folders":[{"path":"kept"}]}')

      await manager.createWorkspaceFile(courseSlug, "tmc")

      expect(fs.readFileSync(workspaceFile, "utf-8")).toBe('{"folders":[{"path":"kept"}]}')
    })

    test("deletes one course's workspace file and leaves the others", async function () {
      const moocWorkspaceFile = resources.getWorkspaceFilePath(courseSlug, "mooc")
      fs.writeFileSync(workspaceFile, JSON.stringify({ folders: [] }))
      fs.writeFileSync(moocWorkspaceFile, JSON.stringify({ folders: [] }))

      const result = await manager.deleteWorkspaceFile(courseSlug, "tmc")

      expect(result.ok).toBe(true)
      expect(fs.existsSync(workspaceFile)).toBe(false)
      expect(fs.existsSync(moocWorkspaceFile)).toBe(true)
    })

    test("accepts a course whose workspace file is already gone", async function () {
      const result = await manager.deleteWorkspaceFile(courseSlug, "tmc")

      expect(result.ok).toBe(true)
    })

    test("deletes every workspace file but keeps the shared root folder", async function () {
      const rootFolderPath = path.join(workspaceFileFolder, WORKSPACE_ROOT_FOLDER_NAME)
      fs.writeFileSync(workspaceFile, JSON.stringify({ folders: [] }))
      fs.writeFileSync(
        resources.getWorkspaceFilePath("another course", "mooc"),
        JSON.stringify({ folders: [] }),
      )
      fs.mkdirSync(rootFolderPath)

      const result = await manager.deleteAllWorkspaceFiles()

      expect(result.ok).toBe(true)
      expect(fs.readdirSync(workspaceFileFolder)).toEqual([WORKSPACE_ROOT_FOLDER_NAME])
    })
  })

  suite("two backends sharing a course slug", function () {
    const courseSlug = "test-python-course"
    let tmcExercise: WorkspaceExercise
    let moocExercise: WorkspaceExercise
    let manager: WorkspaceManager

    beforeEach(function () {
      tmcExercise = exercise("tmc", courseSlug, "hello_world", ExerciseStatus.Closed)
      moocExercise = exercise("mooc", courseSlug, "hello_world", ExerciseStatus.Closed)
      openWorkspaceFile(workspaceFileName(courseSlug, "tmc"))
      manager = new WorkspaceManager(resources, [tmcExercise, moocExercise])
    })

    test("lists only the requested backend's exercises", function () {
      expect(manager.getExercisesByCourseSlug("tmc", courseSlug)).toEqual([tmcExercise])
      expect(manager.getExercisesByCourseSlug("mooc", courseSlug)).toEqual([moocExercise])
    })

    test("opens an exercise only in the requested backend", async function () {
      const result = await manager.openCourseExercises("mooc", courseSlug, ["hello_world"], persist)

      expect(result.ok).toBe(true)
      expect(moocExercise.status).toBe(ExerciseStatus.Open)
      expect(tmcExercise.status).toBe(ExerciseStatus.Closed)
      expect(manager.getExercisesByCourseSlug("tmc", courseSlug)).toEqual([tmcExercise])
    })

    test("closes an exercise only in the requested backend", async function () {
      tmcExercise.status = ExerciseStatus.Open
      moocExercise.status = ExerciseStatus.Open

      const result = await manager.closeCourseExercises(
        "mooc",
        courseSlug,
        ["hello_world"],
        persist,
      )

      expect(result.val).toEqual([moocExercise])
      expect(tmcExercise.status).toBe(ExerciseStatus.Open)
      expect(manager.getExercisesByCourseSlug("mooc", courseSlug)).toEqual([moocExercise])
    })

    test("adds only the active backend's exercises to the workspace", async function () {
      tmcExercise.status = ExerciseStatus.Open
      moocExercise.status = ExerciseStatus.Open

      const result = await manager.setExercises([tmcExercise, moocExercise])

      expect(result.ok).toBe(true)
      expect(updateWorkspaceFolders).toHaveBeenCalledExactlyOnceWith(
        0,
        1,
        { uri: rootFolder.uri },
        { uri: tmcExercise.uri },
      )
    })
  })
})

suite("workspace file creation", function () {
  let workspaceFileFolder: string

  beforeEach(function () {
    workspaceFileFolder = fs.mkdtempSync(path.join(os.tmpdir(), "workspace-files-"))
  })

  afterEach(function () {
    fs.rmSync(workspaceFileFolder, { recursive: true, force: true })
  })

  test("writes a course workspace file with the extension's settings", async function () {
    const workspaceFile = path.join(workspaceFileFolder, workspaceFileName("a course", "mooc"))

    await ensureCourseWorkspaceFile(workspaceFile)

    expect(JSON.parse(fs.readFileSync(workspaceFile, "utf-8"))).toEqual(WORKSPACE_SETTINGS)
  })

  // The file carries the student's own folder list and per-workspace settings.
  test("leaves an existing course workspace file untouched", async function () {
    const workspaceFile = path.join(workspaceFileFolder, workspaceFileName("a course", "tmc"))
    fs.writeFileSync(workspaceFile, '{"folders":[{"path":"kept"}]}')

    await ensureCourseWorkspaceFile(workspaceFile)

    expect(fs.readFileSync(workspaceFile, "utf-8")).toBe('{"folders":[{"path":"kept"}]}')
  })

  test("creates the workspace folder a course file is asked for", async function () {
    const workspaceFile = path.join(
      workspaceFileFolder,
      "not yet there",
      workspaceFileName("a course", "tmc"),
    )

    await ensureCourseWorkspaceFile(workspaceFile)

    expect(fs.existsSync(workspaceFile)).toBe(true)
  })

  test("writes the readme into the workspace root folder", async function () {
    await ensureWorkspaceRootFile(workspaceFileFolder)

    const rootFile = path.join(
      workspaceFileFolder,
      WORKSPACE_ROOT_FOLDER_NAME,
      WORKSPACE_ROOT_FILE_NAME,
    )
    expect(fs.readFileSync(rootFile, "utf-8")).toBe(WORKSPACE_ROOT_FILE_TEXT)
  })

  // It ships with the extension, so an upgrade has to replace the copy on disk.
  test("replaces a readme left by an older version", async function () {
    const rootFile = path.join(
      workspaceFileFolder,
      WORKSPACE_ROOT_FOLDER_NAME,
      WORKSPACE_ROOT_FILE_NAME,
    )
    fs.mkdirSync(path.dirname(rootFile), { recursive: true })
    fs.writeFileSync(rootFile, "an older FAQ")

    await ensureWorkspaceRootFile(workspaceFileFolder)

    expect(fs.readFileSync(rootFile, "utf-8")).toBe(WORKSPACE_ROOT_FILE_TEXT)
  })
})
