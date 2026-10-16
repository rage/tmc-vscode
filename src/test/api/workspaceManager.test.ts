import * as fs from "fs"
import * as os from "os"
import * as path from "path"

import * as jsonc from "jsonc-parser"
import { Err, Ok } from "ts-results"
import type { Mock } from "vitest"
import { vi } from "vitest"
import * as vscode from "vscode"

import type { BackendKind } from "../../../shared/lib"
import type {
  CourseWorkspaceKey,
  PersistClosedCourseExercises,
  WorkspaceExercise,
} from "../../api/workspaceManager"
import WorkspaceManager, {
  ensureCourseWorkspaceFile,
  ensureWorkspaceRootFile,
  ExerciseStatus,
} from "../../api/workspaceManager"
import {
  closedExercisesSettingKey,
  HIDE_META_FILES,
  WATCHER_EXCLUDE,
  WORKSPACE_ROOT_FILE_NAME,
  WORKSPACE_ROOT_FILE_TEXT,
  WORKSPACE_ROOT_FOLDER_NAME,
  WORKSPACE_SETTINGS,
  workspaceFileName,
} from "../../config/constants"
import Resources from "../../config/resources"
import { Logger, LogLevel } from "../../utilities"
import {
  idOfMoocCourse,
  idOfMoocExercise,
  idOfTmcCourse,
  idOfTmcExercise,
} from "../fixtures/identifiers"

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
  textDocuments: Pick<vscode.TextDocument, "uri" | "isDirty">[]
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

type FolderChangeListener = (e: vscode.WorkspaceFoldersChangeEvent) => void
const folderChangeListeners = new Set<FolderChangeListener>()

function notifyFolderChange(e: vscode.WorkspaceFoldersChangeEvent): void {
  folderChangeListeners.forEach((listener) => listener(e))
}

function exercise(
  backend: BackendKind,
  courseSlug: string,
  exerciseSlug: string,
  status: ExerciseStatus,
): WorkspaceExercise {
  const key = `${courseSlug}/${exerciseSlug}`
  return {
    id: backend === "tmc" ? idOfTmcExercise(numberFor(key)) : idOfMoocExercise(key),
    courseId: backend === "tmc" ? idOfTmcCourse(numberFor(courseSlug)) : idOfMoocCourse(courseSlug),
    backend,
    courseSlug,
    exerciseSlug,
    status,
    uri: vscode.Uri.file(path.join(PROJECTS_DIRECTORY, backend, courseSlug, exerciseSlug)),
  }
}

/** A tmc id that differs between the names the tests use. */
function numberFor(name: string): number {
  return [...name].reduce((hash, char) => (hash * 31 + (char.codePointAt(0) ?? 0)) % 1_000_003, 7)
}

function folderOf(uri: vscode.Uri, name: string): vscode.WorkspaceFolder {
  return { uri, name, index: 0 }
}

const persistForCourse: PersistClosedCourseExercises = async () => Ok.EMPTY

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
    resources = new Resources(WORKSPACE_FILE_FOLDER, PROJECTS_DIRECTORY)
    rootFolder = folderOf(resources.workspaceRootFolder, WORKSPACE_ROOT_FOLDER_NAME)
    updateWorkspaceFolders = vi.fn<WorkspaceStubs["updateWorkspaceFolders"]>(() => {
      notifyFolderChange({ added: [], removed: [] })
      return true
    })

    stubWorkspace("workspaceFile", undefined)
    stubWorkspace("name", undefined)
    stubWorkspace("workspaceFolders", [rootFolder])
    folderChangeListeners.clear()
    stubWorkspace("onDidChangeWorkspaceFolders", ((listener: FolderChangeListener) => {
      folderChangeListeners.add(listener)
      return { dispose: () => folderChangeListeners.delete(listener) }
    }) as unknown as WorkspaceStubs["onDidChangeWorkspaceFolders"])
    stubWorkspace(
      "onDidOpenTextDocument",
      vi.fn(() => ({ dispose: vi.fn() })),
    )
    stubWorkspace("updateWorkspaceFolders", updateWorkspaceFolders)
  })

  suite("active course workspace", function () {
    test("reads the course and backend of a tmc workspace file", function () {
      openWorkspaceFile(workspaceFileName("test-python-course", "tmc"))
      const manager = new WorkspaceManager(resources, persistForCourse)
      expect(manager.activeCourse).toBe("test-python-course")
      expect(manager.activeCourseBackend).toBe("tmc")
    })

    test("reads the course and backend of a mooc workspace file", function () {
      openWorkspaceFile(workspaceFileName("test-python-course", "mooc"))
      const manager = new WorkspaceManager(resources, persistForCourse)
      expect(manager.activeCourse).toBe("test-python-course")
      expect(manager.activeCourseBackend).toBe("mooc")
    })

    // Released versions wrote tmc workspace files under this name; it must keep opening.
    test("reads a tmc workspace file named after the bare course slug", function () {
      openWorkspaceFile("test-python-course.code-workspace")
      const manager = new WorkspaceManager(resources, persistForCourse)
      expect(manager.activeCourse).toBe("test-python-course")
      expect(manager.activeCourseBackend).toBe("tmc")
    })

    test("gives a tmc and a mooc course sharing a slug distinct files and settings", function () {
      expect(workspaceFileName("python", "tmc")).not.toBe(workspaceFileName("python", "mooc"))
      expect(closedExercisesSettingKey("tmc", "python")).toBe("closed-exercises-for:python")
      expect(closedExercisesSettingKey("mooc", "python")).not.toBe(
        closedExercisesSettingKey("tmc", "python"),
      )
    })

    test("reads a course slug containing a space", function () {
      openWorkspaceFile(workspaceFileName("my python course", "mooc"))
      const manager = new WorkspaceManager(resources, persistForCourse)
      expect(manager.activeCourse).toBe("my python course")
      expect(manager.activeCourseBackend).toBe("mooc")
    })

    test("has no active course when the open workspace is not a course workspace", function () {
      stubWorkspace("workspaceFile", vscode.Uri.file("/elsewhere/some-project.code-workspace"))
      stubWorkspace("name", "some-project (Workspace)")
      const manager = new WorkspaceManager(resources, persistForCourse)
      expect(manager.activeCourse).toBeUndefined()
      expect(manager.activeCourseBackend).toBeUndefined()
    })

    test("keeps a spaced-slug course's open exercises in its workspace", async function () {
      const open = exercise("mooc", "my python course", "hello_world", ExerciseStatus.Open)
      openWorkspaceFile(workspaceFileName("my python course", "mooc"))
      stubWorkspace("workspaceFolders", [rootFolder, folderOf(open.uri, open.exerciseSlug)])

      const manager = new WorkspaceManager(resources, persistForCourse)
      const result = await manager.setExercises([open])

      expect(result.ok).toBe(true)
      expect(updateWorkspaceFolders).not.toHaveBeenCalled()
    })

    test("announces a replacement that changes the known exercises", async function () {
      const open = exercise("mooc", "my python course", "hello_world", ExerciseStatus.Open)
      const manager = new WorkspaceManager(resources, persistForCourse)
      const changed = vi.fn()
      manager.onDidChangeExercises(changed)

      await manager.setExercises([open])
      await manager.setExercises([{ ...open, status: ExerciseStatus.Closed }])

      expect(changed).toHaveBeenCalledTimes(2)
    })

    // Each listener rebuilds from scratch, the test items among them, and every refresh rescans.
    test("announces nothing for a rescan that found the same exercises", async function () {
      const open = exercise("mooc", "my python course", "hello_world", ExerciseStatus.Open)
      const manager = new WorkspaceManager(resources, persistForCourse)
      await manager.setExercises([open])
      const changed = vi.fn()
      manager.onDidChangeExercises(changed)

      await manager.setExercises([{ ...open, uri: vscode.Uri.file(open.uri.fsPath) }])

      expect(changed).not.toHaveBeenCalled()
    })
  })

  suite("exercise lookup by path", function () {
    const helloWorld = exercise("tmc", "test-python-course", "hello_world", ExerciseStatus.Open)
    let manager: WorkspaceManager

    beforeEach(function () {
      manager = new WorkspaceManager(resources, persistForCourse, [helloWorld])
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

  test("only the workspace folders that are exercises are exercise folders", function () {
    const known = exercise("tmc", "test-python-course", "loops", ExerciseStatus.Open)
    const inside = vscode.Uri.file(path.join(known.uri.fsPath, "src"))
    const addedByHand = vscode.Uri.file("/home/student/notes")
    stubWorkspace("workspaceFolders", [
      rootFolder,
      folderOf(known.uri, "loops"),
      folderOf(inside, "src"),
      folderOf(addedByHand, "notes"),
    ])

    const manager = new WorkspaceManager(resources, persistForCourse, [known])

    expect(manager.exerciseFolders()).toEqual([known.uri])
  })

  suite("opening and closing exercises", function () {
    const courseSlug = "test-python-course"
    let open: WorkspaceExercise
    let closed: WorkspaceExercise
    let record: Mock<PersistClosedCourseExercises>
    let manager: WorkspaceManager

    beforeEach(function () {
      open = exercise("tmc", courseSlug, "hello_world", ExerciseStatus.Open)
      closed = exercise("tmc", courseSlug, "part02-01_greeting", ExerciseStatus.Closed)
      openWorkspaceFile(workspaceFileName(courseSlug, "tmc"))
      stubWorkspace("workspaceFolders", [rootFolder, folderOf(open.uri, open.exerciseSlug)])
      record = vi.fn<PersistClosedCourseExercises>(async () => Ok.EMPTY)
      manager = new WorkspaceManager(resources, record, [open, closed])
    })

    test("records the whole closed set, not only the exercises the caller named", async function () {
      await manager.closeCourseExercises("tmc", courseSlug, [open.id])

      expect(record).toHaveBeenCalledExactlyOnceWith("tmc", courseSlug, [
        "hello_world",
        "part02-01_greeting",
      ])
    })

    test("records the closed set before the workspace shows the change", async function () {
      let workspaceWritesBeforeRecording = -1
      record.mockImplementation(async () => {
        workspaceWritesBeforeRecording = updateWorkspaceFolders.mock.calls.length
        return Ok.EMPTY
      })

      await manager.closeCourseExercises("tmc", courseSlug, [open.id])

      expect(workspaceWritesBeforeRecording).toBe(0)
      expect(updateWorkspaceFolders).toHaveBeenCalledOnce()
    })

    test("changes nothing the user can see when the closed set cannot be recorded", async function () {
      record.mockResolvedValue(Err(new Error("settings are read-only")))

      const result = await manager.closeCourseExercises("tmc", courseSlug, [open.id])

      expect(result.err).toBe(true)
      expect(open.status).toBe(ExerciseStatus.Open)
      expect(updateWorkspaceFolders).not.toHaveBeenCalled()
    })

    test("drops the reopened exercise from the recorded closed set", async function () {
      await manager.openCourseExercises("tmc", courseSlug, [closed.id])

      expect(record).toHaveBeenCalledExactlyOnceWith("tmc", courseSlug, [])
      expect(closed.status).toBe(ExerciseStatus.Open)
    })

    test("records both of two closes requested at once", async function () {
      let finishFirst!: () => void
      record.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishFirst = () => resolve(Ok.EMPTY)
          }),
      )
      const reopened = exercise("tmc", courseSlug, "part03-01_third", ExerciseStatus.Open)
      await manager.setExercises([open, closed, reopened])

      const first = manager.closeCourseExercises("tmc", courseSlug, [open.id])
      const second = manager.closeCourseExercises("tmc", courseSlug, [reopened.id])
      await vi.waitFor(() => expect(record).toHaveBeenCalledOnce())
      finishFirst()
      await Promise.all([first, second])

      expect(record.mock.calls.at(-1)?.[2]).toEqual([
        "hello_world",
        "part02-01_greeting",
        "part03-01_third",
      ])
    })

    test("applies a close to the exercises a refresh put in place meanwhile", async function () {
      let finish!: () => void
      record.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = () => resolve(Ok.EMPTY)
          }),
      )
      const closing = manager.closeCourseExercises("tmc", courseSlug, [open.id])
      await vi.waitFor(() => expect(record).toHaveBeenCalledOnce())
      const refreshedOpen = { ...open }
      await manager.setExercises([refreshedOpen, closed])
      finish()

      const result = await closing

      expect(result.unwrap()).toEqual([refreshedOpen])
      expect(refreshedOpen.status).toBe(ExerciseStatus.Closed)
    })

    test("refuses to open or close while the closed set is unknown", async function () {
      await manager.setExercises([open, closed], false)

      const result = await manager.openCourseExercises("tmc", courseSlug, [closed.id])

      expect(result.err).toBe(true)
      expect(record).not.toHaveBeenCalled()
      expect(closed.status).toBe(ExerciseStatus.Closed)
    })

    test("announces an exercise opening or closing", async function () {
      const changed = vi.fn()
      manager.onDidChangeExercises(changed)

      await manager.closeCourseExercises("tmc", courseSlug, [open.id])

      expect(changed).toHaveBeenCalled()
    })

    test("announces nothing when the closed set cannot be recorded", async function () {
      record.mockResolvedValue(Err(new Error("settings are read-only")))
      const changed = vi.fn()
      manager.onDidChangeExercises(changed)

      await manager.closeCourseExercises("tmc", courseSlug, [open.id])

      expect(changed).not.toHaveBeenCalled()
    })
  })

  // VS Code reports a folder change the extension itself made, so the handler
  // that records it runs again on the state it has just applied.
  suite("recording folders the workspace itself gained or lost", function () {
    const courseSlug = "test-python-course"
    let open: WorkspaceExercise
    let closed: WorkspaceExercise
    let write: Mock<PersistClosedCourseExercises>
    let manager: WorkspaceManager

    beforeEach(function () {
      Logger.configure(LogLevel.None)
      open = exercise("tmc", courseSlug, "hello_world", ExerciseStatus.Open)
      closed = exercise("tmc", courseSlug, "part02-01_greeting", ExerciseStatus.Closed)
      openWorkspaceFile(workspaceFileName(courseSlug, "tmc"))
      stubWorkspace("workspaceFolders", [rootFolder, folderOf(open.uri, open.exerciseSlug)])

      stubWorkspace("updateWorkspaceFolders", ((
        start: number,
        deleteCount: number,
        ...folders: { uri: vscode.Uri }[]
      ) => {
        const previous = vscode.workspace.workspaceFolders ?? []
        const next = [
          ...previous.slice(0, start),
          ...folders.map((folder) => folderOf(folder.uri, path.basename(folder.uri.fsPath))),
          ...previous.slice(start + deleteCount),
        ]
        stubWorkspace("workspaceFolders", next)
        // VS Code diffs the two lists, so a folder the replacement keeps is
        // reported as neither added nor removed.
        const previousPaths = new Set(previous.map((folder) => folder.uri.fsPath))
        const nextPaths = new Set(next.map((folder) => folder.uri.fsPath))
        notifyFolderChange({
          added: next.filter((folder) => !previousPaths.has(folder.uri.fsPath)),
          removed: previous.filter((folder) => !nextPaths.has(folder.uri.fsPath)),
        })
        return true
      }) as unknown as WorkspaceStubs["updateWorkspaceFolders"])

      write = vi.fn<PersistClosedCourseExercises>(async () => Ok.EMPTY)
      manager = new WorkspaceManager(resources, write, [open, closed])
    })

    test("a folder the user removed by hand is recorded as closed", async function () {
      notifyFolderChange({ added: [], removed: [folderOf(open.uri, open.exerciseSlug)] })
      await Promise.resolve()

      expect(write).toHaveBeenCalledExactlyOnceWith("tmc", courseSlug, [
        "hello_world",
        "part02-01_greeting",
      ])
      expect(open.status).toBe(ExerciseStatus.Closed)
    })

    test("announces a folder the user removed by hand", function () {
      const changed = vi.fn()
      manager.onDidChangeExercises(changed)

      notifyFolderChange({ added: [], removed: [folderOf(open.uri, open.exerciseSlug)] })

      expect(changed).toHaveBeenCalledOnce()
    })

    // The workspace move each call makes re-enters the handler, so an
    // unconditional write here would double every CLI call the user's clicks cost.
    test("an open-then-close cycle writes once per change, not once per folder move", async function () {
      await manager.closeCourseExercises("tmc", courseSlug, [open.id])
      await manager.openCourseExercises("tmc", courseSlug, [open.id])

      expect(write.mock.calls).toEqual([
        ["tmc", courseSlug, ["hello_world", "part02-01_greeting"]],
        ["tmc", courseSlug, ["part02-01_greeting"]],
      ])
    })

    test("closing an exercise announces the change once, not again for its folder move", async function () {
      const changed = vi.fn()
      manager.onDidChangeExercises(changed)

      await manager.closeCourseExercises("tmc", courseSlug, [open.id])

      expect(changed).toHaveBeenCalledOnce()
    })

    test("the closed set a refresh was built from is not written back", async function () {
      stubWorkspace("workspaceFolders", [
        rootFolder,
        folderOf(open.uri, open.exerciseSlug),
        folderOf(closed.uri, closed.exerciseSlug),
      ])

      const result = await manager.setExercises([open, closed])

      expect(result.ok).toBe(true)
      expect(write).not.toHaveBeenCalled()
    })

    test("records no folder change while the closed set is unknown", async function () {
      await manager.setExercises([open, closed], false)

      notifyFolderChange({ added: [], removed: [folderOf(open.uri, open.exerciseSlug)] })
      await new Promise((resolve) => {
        setImmediate(resolve)
      })

      expect(write).not.toHaveBeenCalled()
    })

    test("a failed write is retried on the next folder change", async function () {
      write.mockResolvedValueOnce(Err(new Error("settings are read-only")))
      const error = vi.spyOn(Logger, "error").mockImplementation(() => undefined)

      notifyFolderChange({ added: [], removed: [folderOf(open.uri, open.exerciseSlug)] })
      await vi.waitFor(() => expect(error).toHaveBeenCalledOnce())
      notifyFolderChange({ added: [], removed: [folderOf(open.uri, open.exerciseSlug)] })

      await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2))
      expect(error).toHaveBeenCalledOnce()
      error.mockRestore()
    })
  })

  suite("settings writes during a workspace folder change", function () {
    const courseSlug = "test-python-course"
    let isWorkspaceFileDirty: boolean
    let saveFolderChange: (() => void) | undefined
    let update: Mock<UpdateSetting>

    beforeEach(function () {
      openWorkspaceFile(workspaceFileName(courseSlug, "tmc"))
      isWorkspaceFileDirty = false
      saveFolderChange = undefined
      // Like VS Code: the folder list goes into the workspace file's buffer, which is saved
      // before the change event fires.
      stubWorkspace("updateWorkspaceFolders", () => {
        isWorkspaceFileDirty = true
        saveFolderChange = () => {
          isWorkspaceFileDirty = false
          notifyFolderChange({ added: [], removed: [] })
        }
        return true
      })
      update = vi.fn<UpdateSetting>(async () => {
        if (isWorkspaceFileDirty) {
          throw new Error(
            "Unable to write into workspace settings because the file has unsaved changes.",
          )
        }
      })
      stubWorkspace("getConfiguration", () => configurationStub(update))
    })

    test("waits for VS Code to save the folder change before writing a setting", async function () {
      const manager = new WorkspaceManager(resources, persistForCourse)

      const refresh = manager.setExercises([
        exercise("tmc", courseSlug, "hello_world", ExerciseStatus.Open),
      ])
      const settingsWrite = manager.replaceWorkspaceSetting("editor.inlineSuggest.enabled", false)
      await new Promise((resolve) => {
        setTimeout(resolve, 0)
      })
      saveFolderChange?.()

      await expect(settingsWrite).resolves.toBeUndefined()
      expect((await refresh).ok).toBe(true)
      expect(update).toHaveBeenCalledOnce()
    })

    test("moves no folders while a settings write is in flight", async function () {
      let finishSettingsWrite: (() => void) | undefined
      update.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishSettingsWrite = resolve
          }),
      )
      const manager = new WorkspaceManager(resources, persistForCourse)

      const settingsWrite = manager.replaceWorkspaceSetting("editor.inlineSuggest.enabled", false)
      const refresh = manager.setExercises([
        exercise("tmc", courseSlug, "hello_world", ExerciseStatus.Open),
      ])
      await vi.waitFor(() => expect(update).toHaveBeenCalledOnce())

      expect(saveFolderChange).toBeUndefined()
      finishSettingsWrite?.()
      await settingsWrite
      await vi.waitFor(() => expect(saveFolderChange).toBeDefined())
      saveFolderChange?.()
      expect((await refresh).ok).toBe(true)
    })

    test("writes anyway once VS Code has not confirmed a folder change in time", async function () {
      vi.useFakeTimers()
      try {
        const manager = new WorkspaceManager(resources, persistForCourse)
        stubWorkspace("updateWorkspaceFolders", () => true)

        const refresh = manager.setExercises([
          exercise("tmc", courseSlug, "hello_world", ExerciseStatus.Open),
        ])
        const settingsWrite = manager.replaceWorkspaceSetting("editor.inlineSuggest.enabled", false)
        await vi.advanceTimersByTimeAsync(10_000)

        await expect(settingsWrite).resolves.toBeUndefined()
        expect((await refresh).ok).toBe(true)
      } finally {
        vi.useRealTimers()
      }
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

    // A copy in the workspace file would outrank the student's later changes in User settings.
    test("copies none of the extension's own settings into the workspace file", async function () {
      stubExtensions(
        () =>
          ({
            packageJSON: {
              contributes: {
                configuration: {
                  properties: { "testMyCode.downloadOldSubmission": { type: "boolean" } },
                },
              },
            },
          }) as unknown as vscode.Extension<unknown>,
      )
      stubWorkspace("getConfiguration", () => configurationStub(update))

      await new WorkspaceManager(resources, persistForCourse).verifyWorkspaceSettingsIntegrity()

      expect(sectionsWritten()).toEqual(
        expect.arrayContaining([
          "files.watcherExclude",
          "explorer.decorations.colors",
          "problems.decorations.enabled",
        ]),
      )
      expect(sectionsWritten().filter((section) => section.startsWith("testMyCode."))).toEqual([])
    })

    test("merges a section's stored workspace value, not the effective config", async function () {
      stubExtensions(() => undefined)
      stubWorkspace("getConfiguration", () =>
        configurationStub(update, () => ({ "**/legacy": true })),
      )

      await new WorkspaceManager(resources, persistForCourse).verifyWorkspaceSettingsIntegrity()

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

      await new WorkspaceManager(resources, persistForCourse).verifyWorkspaceSettingsIntegrity()

      expect(update).not.toHaveBeenCalled()
    })

    test("writes only the section that drifted", async function () {
      stubExtensions(() => undefined)
      stubWorkspace("getConfiguration", () =>
        configurationStub(update, (section) =>
          section === "problems.decorations.enabled" ? true : alreadyCorrect[section],
        ),
      )

      await new WorkspaceManager(resources, persistForCourse).verifyWorkspaceSettingsIntegrity()

      expect(update).toHaveBeenCalledExactlyOnceWith(
        "problems.decorations.enabled",
        false,
        vscode.ConfigurationTarget.Workspace,
      )
    })

    test("a section VS Code rejects neither stops the others nor fails the pass", async function () {
      const warn = vi.spyOn(Logger, "warn").mockImplementation(() => undefined)
      stubExtensions(() => undefined)
      update.mockImplementation(async (section) => {
        if (section === "files.exclude") {
          throw new Error("does not support workspace scope")
        }
      })
      stubWorkspace("getConfiguration", () => configurationStub(update))

      await new WorkspaceManager(resources, persistForCourse).verifyWorkspaceSettingsIntegrity()

      expect(sectionsWritten()).toEqual(
        expect.arrayContaining([
          "files.watcherExclude",
          "explorer.decorations.colors",
          "explorer.decorations.badges",
          "problems.decorations.enabled",
        ]),
      )
      expect(warn).toHaveBeenCalledWith(
        "Could not write files.exclude into the course workspace file.",
        expect.any(Error),
      )
      warn.mockRestore()
    })

    test("replaces a stored object instead of merging into it", async function () {
      stubWorkspace("getConfiguration", () =>
        configurationStub(update, () => ({ python: true, rust: true })),
      )

      await new WorkspaceManager(resources, persistForCourse).replaceWorkspaceSetting(
        "github.copilot.enable",
        { rust: true },
      )

      expect(update).toHaveBeenCalledExactlyOnceWith(
        "github.copilot.enable",
        { rust: true },
        vscode.ConfigurationTarget.Workspace,
      )
    })

    test("a refused replacement rejects its caller and does not hold up the next write", async function () {
      update.mockRejectedValueOnce(new Error("the file has unsaved changes"))
      stubWorkspace("getConfiguration", () => configurationStub(update))
      const manager = new WorkspaceManager(resources, persistForCourse)

      const refused = manager.replaceWorkspaceSetting("chat.agent.enabled", false)
      const next = manager.replaceWorkspaceSetting("chat.mcp.access", "none")

      await expect(refused).rejects.toThrow("the file has unsaved changes")
      await expect(next).resolves.toBeUndefined()
      expect(sectionsWritten()).toEqual(["chat.agent.enabled", "chat.mcp.access"])
    })

    test("replaces nothing outside a course workspace", async function () {
      stubWorkspace("workspaceFile", undefined)
      stubWorkspace("getConfiguration", () => configurationStub(update))

      await new WorkspaceManager(resources, persistForCourse).replaceWorkspaceSetting(
        "chat.disableAIFeatures",
        true,
      )

      expect(update).not.toHaveBeenCalled()
    })

    test("writes a language's value into that language's block of the workspace file", async function () {
      const getConfiguration = vi.fn((_section?: string, _scope?: unknown) =>
        configurationStub(update),
      )
      stubWorkspace("getConfiguration", getConfiguration)

      await new WorkspaceManager(resources, persistForCourse).replaceWorkspaceSetting(
        "editor.inlineSuggest.enabled",
        false,
        "python",
      )

      expect(getConfiguration).toHaveBeenCalledWith(undefined, {
        uri: vscode.Uri.file(
          path.join(WORKSPACE_FILE_FOLDER, workspaceFileName("test-python-course", "tmc")),
        ),
        languageId: "python",
      })
      expect(update).toHaveBeenCalledExactlyOnceWith(
        "editor.inlineSuggest.enabled",
        false,
        vscode.ConfigurationTarget.Workspace,
        true,
      )
    })

    test("reads a language's stored value from that language's block, and the winning value", function () {
      stubWorkspace(
        "getConfiguration",
        (_section, scope) =>
          ({
            ...configurationStub(update),
            get: () => (scope as { languageId?: string }).languageId === "python",
            inspect: (section: string) => ({
              key: section,
              workspaceValue: false,
              workspaceLanguageValue: "python-block",
            }),
          }) as unknown as vscode.WorkspaceConfiguration,
      )
      const manager = new WorkspaceManager(resources, persistForCourse)

      expect(manager.getStoredWorkspaceSetting("editor.inlineSuggest.enabled")).toBe(false)
      expect(manager.getStoredWorkspaceSetting("editor.inlineSuggest.enabled", "python")).toBe(
        "python-block",
      )
      expect(manager.inspectSetting("editor.inlineSuggest.enabled", "python")?.effectiveValue).toBe(
        true,
      )
    })
  })

  suite("workspaceFileProblem", function () {
    let workspaceFileFolder: string
    let workspaceFile: string
    let manager: WorkspaceManager

    beforeEach(function () {
      workspaceFileFolder = fs.mkdtempSync(path.join(os.tmpdir(), "workspace-manager-"))
      resources = new Resources(workspaceFileFolder, PROJECTS_DIRECTORY)
      workspaceFile = resources.getWorkspaceFilePath("test-python-course", "tmc")
      fs.writeFileSync(workspaceFile, "{}")
      stubWorkspace("workspaceFile", vscode.Uri.file(workspaceFile))
      stubWorkspace("textDocuments", [])
      manager = new WorkspaceManager(resources, persistForCourse)
    })

    afterEach(function () {
      fs.chmodSync(workspaceFile, 0o644)
      fs.rmSync(workspaceFileFolder, { recursive: true, force: true })
    })

    test("finds nothing wrong with a saved, writable file", async function () {
      await expect(manager.workspaceFileProblem()).resolves.toBeUndefined()
    })

    test("finds unsaved changes in an editor", async function () {
      stubWorkspace("textDocuments", [{ uri: vscode.Uri.file(workspaceFile), isDirty: true }])

      await expect(manager.workspaceFileProblem()).resolves.toBe("unsaved")
    })

    test("finds a read-only file", async function () {
      fs.chmodSync(workspaceFile, 0o444)

      await expect(manager.workspaceFileProblem()).resolves.toBe("readOnly")
    })

    test("reports a read-only file left dirty by a failed write as read-only", async function () {
      fs.chmodSync(workspaceFile, 0o444)
      stubWorkspace("textDocuments", [{ uri: vscode.Uri.file(workspaceFile), isDirty: true }])

      await expect(manager.workspaceFileProblem()).resolves.toBe("readOnly")
    })

    test("finds nothing outside a course workspace", async function () {
      stubWorkspace("workspaceFile", undefined)

      await expect(manager.workspaceFileProblem()).resolves.toBeUndefined()
    })
  })

  suite("a document opened in the course workspace", function () {
    function openDocument(fileName: string, languageId: string): WorkspaceManager {
      openWorkspaceFile(workspaceFileName("test-python-course", "tmc"))
      const manager = new WorkspaceManager(resources, persistForCourse)
      const [listener] = vi.mocked(vscode.workspace.onDidOpenTextDocument).mock.calls.at(-1) as [
        (document: vscode.TextDocument) => void,
      ]
      vi.spyOn(manager, "addWorkspaceRecommendation").mockResolvedValue(undefined)
      listener({ languageId, uri: vscode.Uri.file(`/exercises/hello/${fileName}`) } as never)
      return manager
    }

    test("opens rendered when it is a README, as it is the exercise's instructions", function () {
      const executeCommand = vi
        .spyOn(vscode.commands, "executeCommand")
        .mockResolvedValue(undefined)

      openDocument("README.md", "markdown")
      openDocument("notes.md", "markdown")

      expect(
        executeCommand.mock.calls.map(([command, uri]) => [command, (uri as vscode.Uri).fsPath]),
      ).toEqual([["markdown.showPreview", vscode.Uri.file("/exercises/hello/README.md").fsPath]])
      executeCommand.mockRestore()
    })

    test("adds no workspace recommendation in VS Code, which recommends by language itself", function () {
      const manager = openDocument("main.py", "python")

      expect(manager.addWorkspaceRecommendation).not.toHaveBeenCalled()
    })
  })

  suite("addWorkspaceRecommendation", function () {
    const courseSlug = "test-python-course"
    let workspaceFileFolder: string
    let workspaceFile: string
    let manager: WorkspaceManager

    beforeEach(function () {
      workspaceFileFolder = fs.mkdtempSync(path.join(os.tmpdir(), "workspace-manager-"))
      resources = new Resources(workspaceFileFolder, PROJECTS_DIRECTORY)
      workspaceFile = resources.getWorkspaceFilePath(courseSlug, "tmc")
      manager = new WorkspaceManager(resources, persistForCourse)
    })

    afterEach(function () {
      fs.rmSync(workspaceFileFolder, { recursive: true, force: true })
    })

    test("warns instead of rejecting when the workspace file is unreadable", async function () {
      const warn = vi.spyOn(Logger, "warn").mockImplementation(() => undefined)

      await expect(
        manager.addWorkspaceRecommendation(courseSlug, "tmc", ["ms-python.python"]),
      ).resolves.toBeUndefined()
      expect(warn).toHaveBeenCalledOnce()

      warn.mockRestore()
    })

    test("leaves the file untouched when every extension is already recommended", async function () {
      const contents = JSON.stringify(
        { folders: [], extensions: { recommendations: ["ms-python.python"] } },
        null,
        2,
      )
      fs.writeFileSync(workspaceFile, contents)

      await manager.addWorkspaceRecommendation(courseSlug, "tmc", ["ms-python.python"])

      expect(fs.readFileSync(workspaceFile, "utf-8")).toBe(contents)
    })

    test("merges a new extension into the recommendations already there", async function () {
      fs.writeFileSync(
        workspaceFile,
        JSON.stringify({ folders: [], extensions: { recommendations: ["ikuyadeu.r"] } }),
      )

      await manager.addWorkspaceRecommendation(courseSlug, "tmc", ["ms-python.python"])

      const written = fs.readFileSync(workspaceFile, "utf-8")
      expect(JSON.parse(written)).toEqual({
        folders: [],
        extensions: { recommendations: ["ikuyadeu.r", "ms-python.python"] },
      })
      expect(written).toContain("\n")
    })

    test("keeps comments and the other extension lists of a workspace file", async function () {
      fs.writeFileSync(
        workspaceFile,
        [
          "{",
          "  // the course's own folders",
          '  "folders": [],',
          '  "extensions": {',
          '    "recommendations": ["ikuyadeu.r"],',
          '    "unwantedRecommendations": ["github.copilot"],',
          "  },",
          "}",
        ].join("\n"),
      )

      await manager.addWorkspaceRecommendation(courseSlug, "tmc", ["ms-python.python"])

      const written = fs.readFileSync(workspaceFile, "utf-8")
      expect(written).toContain("// the course's own folders")
      expect(jsonc.parse(written)).toEqual({
        folders: [],
        extensions: {
          recommendations: ["ikuyadeu.r", "ms-python.python"],
          unwantedRecommendations: ["github.copilot"],
        },
      })
    })

    test("recommends into a workspace file that lists none yet", async function () {
      fs.writeFileSync(workspaceFile, JSON.stringify({ folders: [] }))

      await manager.addWorkspaceRecommendation(courseSlug, "tmc", ["ms-python.python"])

      const written = JSON.parse(fs.readFileSync(workspaceFile, "utf-8"))
      expect(written.extensions.recommendations).toEqual(["ms-python.python"])
    })

    test("waits for a settings write to the same file before rewriting it", async function () {
      fs.writeFileSync(workspaceFile, JSON.stringify({ folders: [] }))
      stubWorkspace("workspaceFile", vscode.Uri.file(workspaceFile))
      let finishSettingsWrite: (() => void) | undefined
      const update = vi.fn<UpdateSetting>(
        () =>
          new Promise<void>((resolve) => {
            finishSettingsWrite = resolve
          }),
      )
      stubWorkspace("getConfiguration", () => configurationStub(update))

      const settingsWrite = manager.replaceWorkspaceSetting("chat.agent.enabled", false)
      const recommendation = manager.addWorkspaceRecommendation(courseSlug, "tmc", [
        "ms-python.python",
      ])
      await vi.waitFor(() => expect(update).toHaveBeenCalledOnce())
      await new Promise((resolve) => {
        setTimeout(resolve, 0)
      })

      expect(JSON.parse(fs.readFileSync(workspaceFile, "utf-8"))).toEqual({ folders: [] })
      finishSettingsWrite?.()
      await Promise.all([settingsWrite, recommendation])
      expect(JSON.parse(fs.readFileSync(workspaceFile, "utf-8")).extensions).toEqual({
        recommendations: ["ms-python.python"],
      })
    })

    test("creates a course's workspace file where its resources put it", async function () {
      await manager.createWorkspaceFile(courseSlug, "tmc")

      expect(JSON.parse(fs.readFileSync(workspaceFile, "utf-8"))).toEqual(WORKSPACE_SETTINGS)
    })

    test("lists the course's open exercises in its workspace file before it opens", async function () {
      manager = new WorkspaceManager(resources, persistForCourse, [
        exercise("tmc", courseSlug, "b_exercise", ExerciseStatus.Open),
        exercise("tmc", courseSlug, "a_exercise", ExerciseStatus.Open),
        exercise("tmc", courseSlug, "closed_exercise", ExerciseStatus.Closed),
        exercise("tmc", "another-course", "a_exercise", ExerciseStatus.Open),
        exercise("mooc", courseSlug, "a_exercise", ExerciseStatus.Open),
      ])
      fs.writeFileSync(
        workspaceFile,
        '{\n  // the student\'s note\n  "folders": [{ "path": ".tmc" }],\n  "settings": { "a": 1 }\n}',
      )

      await manager.prepareWorkspaceFileToOpen(courseSlug, "tmc")

      const text = fs.readFileSync(workspaceFile, "utf-8")
      expect(text).toContain("// the student's note")
      expect(jsonc.parse(text)).toEqual({
        folders: [
          { path: WORKSPACE_ROOT_FOLDER_NAME },
          { path: path.join(PROJECTS_DIRECTORY, "tmc", courseSlug, "a_exercise") },
          { path: path.join(PROJECTS_DIRECTORY, "tmc", courseSlug, "b_exercise") },
        ],
        settings: { a: 1 },
      })
    })

    test("creates the workspace file it prepares to open", async function () {
      await manager.prepareWorkspaceFileToOpen(courseSlug, "tmc")

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

  suite("exercises opened where this window does not show them", function () {
    const courseSlug = "test-python-course"
    let opened: CourseWorkspaceKey[]
    let manager: WorkspaceManager

    beforeEach(async function () {
      opened = []
      manager = new WorkspaceManager(resources, persistForCourse)
      manager.onDidOpenOutsideCourseWorkspace((course) => void opened.push(course))
      await manager.setExercises([exercise("mooc", courseSlug, "first", ExerciseStatus.Closed)])
    })

    test("a download, open by default, is announced once for its course", async function () {
      await manager.setExercises([
        exercise("mooc", courseSlug, "first", ExerciseStatus.Closed),
        exercise("mooc", courseSlug, "second", ExerciseStatus.Open),
        exercise("mooc", courseSlug, "third", ExerciseStatus.Open),
      ])

      expect(opened).toEqual([{ backend: "mooc", courseSlug }])
    })

    test("the exercises found on startup are not announced", async function () {
      const startup = new WorkspaceManager(resources, persistForCourse)
      startup.onDidOpenOutsideCourseWorkspace((course) => void opened.push(course))

      await startup.setExercises([exercise("mooc", courseSlug, "first", ExerciseStatus.Open)])

      expect(opened).toEqual([])
    })

    test("opening a closed exercise is announced, and opening an open one is not", async function () {
      const closed = exercise("mooc", courseSlug, "first", ExerciseStatus.Closed)

      await manager.openCourseExercises("mooc", courseSlug, [closed.id])
      await manager.openCourseExercises("mooc", courseSlug, [closed.id])

      expect(opened).toEqual([{ backend: "mooc", courseSlug }])
    })

    test("nothing is announced inside that course's own workspace", async function () {
      openWorkspaceFile(workspaceFileName(courseSlug, "mooc"))

      await manager.setExercises([
        exercise("mooc", courseSlug, "first", ExerciseStatus.Closed),
        exercise("mooc", courseSlug, "second", ExerciseStatus.Open),
      ])
      await manager.openCourseExercises("mooc", courseSlug, [
        exercise("mooc", courseSlug, "first", ExerciseStatus.Closed).id,
      ])

      expect(opened).toEqual([])
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
      manager = new WorkspaceManager(resources, persistForCourse, [tmcExercise, moocExercise])
    })

    test("lists only the requested backend's exercises", function () {
      expect(manager.getExercisesByCourseSlug("tmc", courseSlug)).toEqual([tmcExercise])
      expect(manager.getExercisesByCourseSlug("mooc", courseSlug)).toEqual([moocExercise])
    })

    test("opens an exercise only in the requested backend", async function () {
      const result = await manager.openCourseExercises("mooc", courseSlug, [moocExercise.id])

      expect(result.ok).toBe(true)
      expect(moocExercise.status).toBe(ExerciseStatus.Open)
      expect(tmcExercise.status).toBe(ExerciseStatus.Closed)
      expect(manager.getExercisesByCourseSlug("tmc", courseSlug)).toEqual([tmcExercise])
    })

    test("closes an exercise only in the requested backend", async function () {
      tmcExercise.status = ExerciseStatus.Open
      moocExercise.status = ExerciseStatus.Open

      const result = await manager.closeCourseExercises("mooc", courseSlug, [moocExercise.id])

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
