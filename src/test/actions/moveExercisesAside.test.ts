import * as os from "os"
import * as path from "path"

import * as fs from "fs-extra"
import { Err, Ok } from "ts-results"
import { onTestFinished, vi } from "vitest"

import { bringBackMovedExercises, moveExercisesAside } from "../../actions/moveExercisesAside"
import type { ReadyActionContext } from "../../actions/types"
import type Langs from "../../api/langs"
import { langsError } from "../../api/langsErrors"
import type Resources from "../../config/resources"
import { releaseExerciseEditors } from "../../window/exerciseDocuments"
import { createMockActionContext } from "../mocks/actionContext"

vi.mock("../../actions/refreshLocalExercises", () => ({
  refreshLocalExercises: vi.fn(async () => Ok.EMPTY),
}))
vi.mock("../../window/exerciseDocuments", () => ({
  releaseExerciseEditors: vi.fn(async () => Ok.EMPTY),
}))

const PROJECTS = "/home/student/tmcdata"

function contextWith(langs: Partial<Langs>): ReadyActionContext {
  return createMockActionContext({
    startup: {
      langs: langs as Langs,
      resources: { projectsDirectory: PROJECTS } as unknown as Resources,
    },
  })
}

suite("moveExercisesAside", function () {
  test("sets the projects aside into a stamped sibling folder", async function () {
    const setProjectsAside = vi.fn(async () => Ok.EMPTY)

    const moved = await moveExercisesAside(contextWith({ setProjectsAside }), new Date(0))

    expect(moved.val).toBe(`${PROJECTS}-moved-1970-01-01T00-00-00`)
    expect(setProjectsAside).toHaveBeenCalledExactlyOnceWith(moved.val)
  })

  test("passes on langs' refusal, naming the held entry", async function () {
    const held = langsError({ kind: "file-in-use", path: `${PROJECTS}/a` }, "busy", "", undefined)

    const moved = await moveExercisesAside(
      contextWith({ setProjectsAside: vi.fn(async () => Err(held)) }),
    )

    expect(moved.val).toBe(held)
  })

  test("moves nothing while an editor stays open", async function () {
    vi.mocked(releaseExerciseEditors).mockResolvedValueOnce(Err(new Error("open")))
    const setProjectsAside = vi.fn(async () => Ok.EMPTY)

    const moved = await moveExercisesAside(contextWith({ setProjectsAside }))

    expect(moved.err).toBe(true)
    expect(setProjectsAside).not.toHaveBeenCalled()
  })
})

suite("bringBackMovedExercises", function () {
  test("restores the folder through langs", async function () {
    const restoreProjects = vi.fn(async () => Ok.EMPTY)

    const brought = await bringBackMovedExercises(contextWith({ restoreProjects }), "/aside")

    expect(brought.val).toBe(true)
    expect(restoreProjects).toHaveBeenCalledExactlyOnceWith("/aside")
  })

  test("recreates an exercises folder deleted by hand before restoring into it", async function () {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tmc-aside-"))
    onTestFinished(() => fs.removeSync(root))
    const projectsDirectory = path.join(root, "tmcdata")
    const restoreProjects = vi.fn(async () => {
      expect(fs.existsSync(projectsDirectory)).toBe(true)
      return Ok.EMPTY
    })
    const context = createMockActionContext({
      startup: {
        langs: { restoreProjects } as unknown as Langs,
        resources: { projectsDirectory } as unknown as Resources,
      },
    })

    const brought = await bringBackMovedExercises(context, "/aside")

    expect(brought.val).toBe(true)
  })

  test("leaves the folder where it is when the exercises folder has what it would bring back", async function () {
    const conflict = langsError({ kind: "projects-restore-conflict" }, "exists", "", undefined)

    const brought = await bringBackMovedExercises(
      contextWith({ restoreProjects: vi.fn(async () => Err(conflict)) }),
      "/aside",
    )

    expect(brought.ok && brought.val).toBe(false)
  })
})
