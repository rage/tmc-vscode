import * as path from "path"

import type { Mock } from "vitest"
import { vi } from "vitest"
import * as vscode from "vscode"

import type { WorkspaceExercise } from "../../api/workspaceManager"
import WorkspaceManager, { ExerciseStatus } from "../../api/workspaceManager"
import { WORKSPACE_ROOT_FOLDER_NAME, workspaceFileName } from "../../config/constants"
import Resources from "../../config/resources"

// `Resources` reads `vscode.env.appName` to tell Code from VSCodium, and the
// mock ships no `env`.
const vscodeModule = vscode as unknown as { env: { appName: string } }
Object.defineProperty(vscodeModule, "env", {
  value: { appName: "Visual Studio Code" },
  configurable: true,
})

const WORKSPACE_FILE_FOLDER = "/tmc/workspaces"
const PROJECTS_DIRECTORY = "/tmc/projects"

interface WorkspaceStubs {
  workspaceFile: vscode.Uri | undefined
  name: string | undefined
  workspaceFolders: vscode.WorkspaceFolder[] | undefined
  createFileSystemWatcher: () => Pick<vscode.FileSystemWatcher, "onDidDelete" | "dispose">
  onDidChangeWorkspaceFolders: () => vscode.Disposable
  onDidOpenTextDocument: () => vscode.Disposable
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

/**
 * Opens `fileName` as the window's workspace file, together with the display
 * name VS Code derives from it.
 */
function openWorkspaceFile(fileName: string): void {
  stubWorkspace("workspaceFile", vscode.Uri.file(path.join(WORKSPACE_FILE_FOLDER, fileName)))
  stubWorkspace("name", `${path.basename(fileName, ".code-workspace")} (Workspace)`)
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
      "createFileSystemWatcher",
      vi.fn(() => ({ onDidDelete: vi.fn(), dispose: vi.fn() })),
    )
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

  suite("getExerciseByPath", function () {
    const helloWorld = exercise("tmc", "test-python-course", "hello_world", ExerciseStatus.Open)
    let manager: WorkspaceManager

    beforeEach(function () {
      manager = new WorkspaceManager(resources, [helloWorld])
    })

    test("finds the exercise by its own folder", function () {
      expect(manager.getExerciseByPath(helloWorld.uri)?.exerciseSlug).toBe("hello_world")
    })

    test("finds the exercise a file inside it belongs to", function () {
      const file = vscode.Uri.file(path.join(helloWorld.uri.fsPath, "src", "hello.py"))
      expect(manager.getExerciseByPath(file)?.exerciseSlug).toBe("hello_world")
    })

    test("does not match a sibling folder the exercise name prefixes", function () {
      const sibling = vscode.Uri.file(`${helloWorld.uri.fsPath}_2`)
      expect(manager.getExerciseByPath(sibling)).toBeUndefined()
    })

    test("does not match the course folder above the exercise", function () {
      const courseFolder = vscode.Uri.file(path.dirname(helloWorld.uri.fsPath))
      expect(manager.getExerciseByPath(courseFolder)).toBeUndefined()
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
      const result = await manager.openCourseExercises("mooc", courseSlug, ["hello_world"])

      expect(result.ok).toBe(true)
      expect(moocExercise.status).toBe(ExerciseStatus.Open)
      expect(tmcExercise.status).toBe(ExerciseStatus.Closed)
      expect(manager.getExercisesByCourseSlug("tmc", courseSlug)).toEqual([tmcExercise])
    })

    test("closes an exercise only in the requested backend", async function () {
      tmcExercise.status = ExerciseStatus.Open
      moocExercise.status = ExerciseStatus.Open

      const result = await manager.closeCourseExercises("mooc", courseSlug, ["hello_world"])

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
