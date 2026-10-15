import * as fs from "fs"
import * as path from "path"

import { Ok } from "ts-results"
import * as vscode from "vscode"

import {
  fingerprintStudentFiles,
  isUnchangedSinceSubmission,
  recordSubmittedFingerprint,
} from "../../actions/submittedState"
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

suite("the submitted state of an exercise", function () {
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

  test("is unchanged only while the files match what the last submission sent", async function () {
    const root = makeTmpDirs({ "src/main.py": "print(1)" })
    const context = contextFor(["src"])
    const exercise = { id: idOfTmcExercise(77), uri: vscode.Uri.file(root) }

    expect(await isUnchangedSinceSubmission(context, exercise)).toBe(false)

    recordSubmittedFingerprint(exercise.id, await fingerprintStudentFiles(context, exercise))
    expect(await isUnchangedSinceSubmission(context, exercise)).toBe(true)

    fs.writeFileSync(path.join(root, "src/main.py"), "print(2)")
    expect(await isUnchangedSinceSubmission(context, exercise)).toBe(false)
  })
})
