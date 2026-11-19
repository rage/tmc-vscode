import * as path from "path"

import * as fs from "fs-extra"
import * as tmp from "tmp"
import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
import { vi } from "vitest"

import type { ReadyActionContext } from "../../actions/types"
import { wipeExtensionData } from "../../actions/wipeExtensionData"
import type Langs from "../../api/langs"
import type WorkspaceManager from "../../api/workspaceManager"
import type { UserData } from "../../config/userdata"
import { downloadFailures } from "../../ui/downloadFailures"
import { updateablesRegistry } from "../../ui/updateablesRegistry"
import { idOfTmcCourse, idOfTmcExercise } from "../fixtures/identifiers"
import { createMockActionContext } from "../mocks/actionContext"

let projectsDirectory: string
let projectsRoot: tmp.DirResult

/** Names of the wipe steps that ran, in the order they ran. */
const stepsRun: string[] = []

function step<T>(name: string, outcome: () => T): () => Promise<T> {
  return async () => {
    stepsRun.push(isOnDisk("mooc") ? name : `${name} without the exercises`)
    return outcome()
  }
}

function isOnDisk(entry: string): boolean {
  return fs.existsSync(path.join(projectsDirectory, entry))
}

/** What tmc-langs keeps in the projects directory, current and legacy layouts alike. */
function writeManagedEntries(): void {
  fs.outputFileSync(path.join(projectsDirectory, "mooc", "course", "ex", "main.py"), "")
  fs.outputFileSync(path.join(projectsDirectory, "tmc", "course", "ex", "Main.java"), "")
  fs.outputFileSync(path.join(projectsDirectory, "old-course", "course_config.toml"), "")
  fs.outputFileSync(path.join(projectsDirectory, ".tmc.lock"), "")
}

function context(
  options: {
    resetSettings?: Result<void, Error>
    wipeDataFromStorage?: Result<void, Error>
    deleteAllWorkspaceFiles?: Result<void, Error>
  } = {},
): ReadyActionContext {
  return createMockActionContext({
    startup: {
      langs: {
        resetSettings: vi.fn(step("resetSettings", () => options.resetSettings ?? Ok.EMPTY)),
        deauthenticate: vi.fn(step("deauthenticate", () => Ok.EMPTY)),
      } as unknown as Langs,
      userData: {
        wipeDataFromStorage: vi.fn(
          step("wipeDataFromStorage", () => options.wipeDataFromStorage ?? Ok.EMPTY),
        ),
      } as unknown as UserData,
      workspaceManager: {
        deleteAllWorkspaceFiles: vi.fn(
          step("deleteAllWorkspaceFiles", () => options.deleteAllWorkspaceFiles ?? Ok.EMPTY),
        ),
      } as unknown as WorkspaceManager,
    },
  })
}

suite("wipeExtensionData action", function () {
  beforeEach(function () {
    stepsRun.length = 0
    projectsRoot = tmp.dirSync({ unsafeCleanup: true })
    projectsDirectory = path.join(projectsRoot.name, "projects")
    writeManagedEntries()
  })

  afterEach(function () {
    projectsRoot.removeCallback()
  })

  test("removes the projects directory once nothing but the exercises was in it", async function () {
    const result = await wipeExtensionData(context(), projectsDirectory)

    expect(result.ok).toBe(true)
    expect(fs.existsSync(projectsDirectory)).toBe(false)
  })

  test("keeps files of the student's own in the projects directory, and the directory", async function () {
    fs.outputFileSync(path.join(projectsDirectory, "notes", "todo.txt"), "mine")

    await wipeExtensionData(context(), projectsDirectory)

    expect(fs.readdirSync(projectsDirectory)).toEqual(["notes"])
    expect(fs.readFileSync(path.join(projectsDirectory, "notes", "todo.txt"), "utf8")).toBe("mine")
  })

  test("succeeds when the projects directory is already gone", async function () {
    fs.removeSync(projectsDirectory)

    expect((await wipeExtensionData(context(), projectsDirectory)).ok).toBe(true)
  })

  test("deletes the exercises only after every recoverable step has succeeded", async function () {
    await wipeExtensionData(context(), projectsDirectory)
    expect(stepsRun).toEqual([
      "resetSettings",
      "deauthenticate",
      "wipeDataFromStorage",
      "deleteAllWorkspaceFiles",
    ])
    expect(isOnDisk("mooc")).toBe(false)
  })

  // Deleting the exercises with their records still stored would show courses whose work is gone.
  test("leaves the exercises on disk when the stored data cannot be wiped", async function () {
    const error = new Error("storage is read-only")

    const result = await wipeExtensionData(
      context({ wipeDataFromStorage: Err(error) }),
      projectsDirectory,
    )

    expect(result.val).toBe(error)
    expect(isOnDisk("mooc")).toBe(true)
  })

  test("forgets the updates and failed downloads of the courses it wiped", async function () {
    const course = idOfTmcCourse(1)
    const exercise = idOfTmcExercise(2)
    updateablesRegistry.setMany([[course, [exercise]]])
    downloadFailures.record([exercise], [])

    await wipeExtensionData(context(), projectsDirectory)

    expect(updateablesRegistry.get(course)).toEqual([])
    expect(downloadFailures.has(exercise)).toBe(false)
  })

  test("leaves the exercises on disk when an earlier step fails", async function () {
    const result = await wipeExtensionData(
      context({ resetSettings: Err(new Error("settings are read-only")) }),
      projectsDirectory,
    )
    expect(isOnDisk("mooc")).toBe(true)
    expect(result.err).toBe(true)
  })

  test("leaves the exercises on disk when the workspace files cannot be removed", async function () {
    const result = await wipeExtensionData(
      context({ deleteAllWorkspaceFiles: Err(new Error("workspace folder is read-only")) }),
      projectsDirectory,
    )
    expect(isOnDisk("mooc")).toBe(true)
    expect(result.err).toBe(true)
  })

  test("reports the removal fraction at each step, ending at 1", async function () {
    const report = vi.fn()
    await wipeExtensionData(context(), projectsDirectory, report)
    expect(report.mock.calls.map(([progress]) => progress.fraction)).toEqual([
      0.2, 0.4, 0.6, 0.8, 1,
    ])
  })
})
