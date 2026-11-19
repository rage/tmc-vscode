import * as fs from "fs"
import * as path from "path"

import { Ok } from "ts-results"
import { vi } from "vitest"
import * as vscode from "vscode"

import { makeMoocKind } from "../../../shared/lib"
import { findKeptCopy, resetExercise, restoreOldSubmission } from "../../actions"
import type { ReadyActionContext } from "../../actions/types"
import type Langs from "../../api/langs"
import type { WorkspaceExercise } from "../../api/workspaceManager"
import { ExerciseStatus } from "../../api/workspaceManager"
import { idOfMoocCourse, idOfMoocExercise } from "../fixtures/identifiers"
import { createMockActionContext } from "../mocks/actionContext"
import { makeTmpDirs } from "../utils"

vi.mock("../../window/exerciseDocuments", () => ({
  saveExerciseDocuments: vi.fn(async () => Ok.EMPTY),
}))

function setUp(): {
  context: ReadyActionContext
  exercise: WorkspaceExercise
  write: (code: string) => void
} {
  const root = makeTmpDirs({ "src/main.py": "template" })
  const write = (code: string): void => fs.writeFileSync(path.join(root, "src/main.py"), code)
  const langs = {
    getStudentFilePaths: async () => Ok(["src"]),
    resetExercise: vi.fn(async () => {
      write("template")
      return Ok.EMPTY
    }),
    restoreSubmission: vi.fn(async () => {
      write("restored")
      return Ok("restored")
    }),
  } as unknown as Langs
  const exercise: WorkspaceExercise = {
    id: idOfMoocExercise("e1"),
    courseId: idOfMoocCourse("c1"),
    backend: "mooc",
    courseSlug: "course",
    exerciseSlug: "e1",
    status: ExerciseStatus.Open,
    uri: vscode.Uri.file(root),
  }
  return { context: createMockActionContext({ startup: { langs } }), exercise, write }
}

suite("the copies a reset or restore leaves kept", function () {
  test("a backed-up reset keeps the backed-up code and the template", async function () {
    const { context, exercise, write } = setUp()
    write("work")

    await resetExercise(context, exercise.id, exercise, true)

    expect(await findKeptCopy(context, exercise)).toBe("reset")
    write("work")
    expect(await findKeptCopy(context, exercise)).toBe("backup")
  })

  test("a reset without backup keeps only the template", async function () {
    const { context, exercise, write } = setUp()
    write("work")

    await resetExercise(context, exercise.id, exercise, false)
    write("work")

    expect(await findKeptCopy(context, exercise)).toBeUndefined()
  })

  test("a restore keeps the restored code", async function () {
    const { context, exercise } = setUp()
    const target = makeMoocKind({ exerciseId: "e1", submissionId: "s1" })

    await restoreOldSubmission(context, exercise, target, false)

    expect(await findKeptCopy(context, exercise)).toBe("restore")
  })
})
