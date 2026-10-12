import * as fs from "fs-extra"
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

vi.mock("fs-extra", () => ({ remove: vi.fn() }))

const PROJECTS_DIRECTORY = "/tmp/tmcdata/projects"

/** Names of the wipe steps that ran, in the order they ran. */
const stepsRun: string[] = []

function step<T>(name: string, outcome: () => T): () => Promise<T> {
  return async () => {
    stepsRun.push(name)
    return outcome()
  }
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
    vi.mocked(fs.remove).mockReset()
    vi.mocked(fs.remove).mockImplementation(() => {
      stepsRun.push("remove")
    })
  })

  test("removes the projects directory it was given", async function () {
    await wipeExtensionData(context(), PROJECTS_DIRECTORY)
    expect(fs.remove).toHaveBeenCalledWith(PROJECTS_DIRECTORY)
  })

  test("deletes the exercises only after every recoverable step has succeeded", async function () {
    await wipeExtensionData(context(), PROJECTS_DIRECTORY)
    expect(stepsRun).toEqual([
      "resetSettings",
      "deauthenticate",
      "wipeDataFromStorage",
      "deleteAllWorkspaceFiles",
      "remove",
    ])
  })

  // Deleting the exercises with their records still stored would show courses whose work is gone.
  test("leaves the exercises on disk when the stored data cannot be wiped", async function () {
    const error = new Error("storage is read-only")

    const result = await wipeExtensionData(
      context({ wipeDataFromStorage: Err(error) }),
      PROJECTS_DIRECTORY,
    )

    expect(result.val).toBe(error)
    expect(fs.remove).not.toHaveBeenCalled()
  })

  test("forgets the updates and failed downloads of the courses it wiped", async function () {
    const course = idOfTmcCourse(1)
    const exercise = idOfTmcExercise(2)
    updateablesRegistry.setMany([[course, [exercise]]])
    downloadFailures.record([exercise], [])

    await wipeExtensionData(context(), PROJECTS_DIRECTORY)

    expect(updateablesRegistry.get(course)).toEqual([])
    expect(downloadFailures.has(exercise)).toBe(false)
  })

  test("leaves the exercises on disk when an earlier step fails", async function () {
    const result = await wipeExtensionData(
      context({ resetSettings: Err(new Error("settings are read-only")) }),
      PROJECTS_DIRECTORY,
    )
    expect(fs.remove).not.toHaveBeenCalled()
    expect(result.err).toBe(true)
  })

  test("leaves the exercises on disk when the workspace files cannot be removed", async function () {
    const result = await wipeExtensionData(
      context({ deleteAllWorkspaceFiles: Err(new Error("workspace folder is read-only")) }),
      PROJECTS_DIRECTORY,
    )
    expect(fs.remove).not.toHaveBeenCalled()
    expect(result.err).toBe(true)
  })

  test("reports the removal fraction at each step, ending at 1", async function () {
    const report = vi.fn()
    await wipeExtensionData(context(), PROJECTS_DIRECTORY, report)
    expect(report.mock.calls.map(([progress]) => progress.fraction)).toEqual([
      0.2, 0.4, 0.6, 0.8, 1,
    ])
  })
})
