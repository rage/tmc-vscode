import * as os from "os"
import * as path from "path"

import * as fs from "fs-extra"
import { Ok } from "ts-results"
import { onTestFinished, vi } from "vitest"

import { bringBackMovedExercises } from "../../actions/moveExercisesAside"
import type { ReadyActionContext } from "../../actions/types"
import type Resources from "../../config/resources"
import { createMockActionContext } from "../mocks/actionContext"

vi.mock("../../actions/refreshLocalExercises", () => ({
  refreshLocalExercises: vi.fn(async () => Ok.EMPTY),
}))

function folders(): { projects: string; aside: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tmc-aside-"))
  onTestFinished(() => fs.removeSync(root))
  const projects = path.join(root, "projects")
  const aside = path.join(root, "projects-moved")
  fs.ensureDirSync(projects)
  fs.ensureDirSync(aside)
  return { projects, aside }
}

function contextWith(projectsDirectory: string): ReadyActionContext {
  return createMockActionContext({
    startup: { resources: { projectsDirectory } as unknown as Resources },
  })
}

suite("bringBackMovedExercises", function () {
  test("ignores the files the OS puts in an emptied exercises folder", async function () {
    const { projects, aside } = folders()
    fs.writeFileSync(path.join(projects, ".DS_Store"), "")
    fs.outputFileSync(path.join(aside, "course", "exercise", "a.py"), "print()")

    const brought = await bringBackMovedExercises(contextWith(projects), aside)

    expect(brought.val).toBe(true)
    expect(fs.existsSync(path.join(projects, "course", "exercise", "a.py"))).toBe(true)
    expect(fs.existsSync(aside)).toBe(false)
  })

  test("finishes a bring-back that was cut short", async function () {
    const { projects, aside } = folders()
    fs.outputFileSync(path.join(projects, "first", "a.py"), "")
    fs.writeFileSync(path.join(projects, ".tmc-bringing-back"), aside)
    fs.outputFileSync(path.join(aside, "second", "b.py"), "")

    const brought = await bringBackMovedExercises(contextWith(projects), aside)

    expect(brought.val).toBe(true)
    expect(fs.readdirSync(projects).toSorted()).toEqual(["first", "second"])
  })

  test("leaves another account's exercises folder alone", async function () {
    const { projects, aside } = folders()
    fs.outputFileSync(path.join(projects, "theirs", "a.py"), "")
    fs.outputFileSync(path.join(aside, "mine", "b.py"), "")

    const brought = await bringBackMovedExercises(contextWith(projects), aside)

    expect(brought.val).toBe(false)
    expect(fs.existsSync(path.join(aside, "mine"))).toBe(true)
  })
})
