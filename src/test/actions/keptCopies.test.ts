import * as fs from "fs"
import * as path from "path"

import { Ok } from "ts-results"
import * as vscode from "vscode"

import { fingerprintStudentFiles, findKeptCopy, recordKeptCopy } from "../../actions/keptCopies"
import type { ReadyActionContext } from "../../actions/types"
import type Langs from "../../api/langs"
import { idOfTmcExercise } from "../fixtures/identifiers"
import { createMockActionContext } from "../mocks/actionContext"
import { makeTmpDirs } from "../utils"

function contextFor(studentPaths: string[]): ReadyActionContext {
  return createMockActionContext({
    startup: {
      langs: { getStudentFilePaths: async () => Ok(studentPaths) } as unknown as Langs,
    },
  })
}

suite("the kept copies of an exercise", function () {
  test("a fingerprint covers the student files, not the tests or tool output", async function () {
    const root = makeTmpDirs({ "src/main.py": "print(1)", "test/test_main.py": "x" })
    const context = contextFor(["src"])
    const exercise = { uri: vscode.Uri.file(root) }
    const before = await fingerprintStudentFiles(context, exercise)

    fs.writeFileSync(path.join(root, "test/test_main.py"), "changed")
    fs.mkdirSync(path.join(root, "src/__pycache__"))
    fs.writeFileSync(path.join(root, "src/__pycache__/main.pyc"), "bytes")
    expect(await fingerprintStudentFiles(context, exercise)).toBe(before)

    fs.writeFileSync(path.join(root, "src/main.py"), "print(2)")
    expect(await fingerprintStudentFiles(context, exercise)).not.toBe(before)
  })

  test("is kept only while the files match a recorded copy", async function () {
    const root = makeTmpDirs({ "src/main.py": "print(1)" })
    const context = contextFor(["src"])
    const exercise = { id: idOfTmcExercise(77), uri: vscode.Uri.file(root) }

    expect(await findKeptCopy(context, exercise)).toBeUndefined()

    await recordKeptCopy(context, exercise, "submission")
    expect(await findKeptCopy(context, exercise)).toBe("submission")

    fs.writeFileSync(path.join(root, "src/main.py"), "print(2)")
    expect(await findKeptCopy(context, exercise)).toBeUndefined()
  })

  test("remembers the template and the last backup apart from the last submission", async function () {
    const root = makeTmpDirs({ "src/main.py": "template" })
    const context = contextFor(["src"])
    const exercise = { id: idOfTmcExercise(78), uri: vscode.Uri.file(root) }
    const write = (code: string): void => fs.writeFileSync(path.join(root, "src/main.py"), code)

    await recordKeptCopy(context, exercise, "download")
    write("backed up")
    await recordKeptCopy(context, exercise, "backup")
    write("submitted")
    await recordKeptCopy(context, exercise, "submission")

    write("template")
    expect(await findKeptCopy(context, exercise)).toBe("download")
    write("backed up")
    expect(await findKeptCopy(context, exercise)).toBe("backup")
  })
})
