import * as fs from "fs"
import * as path from "path"

import { Ok } from "ts-results"
import { vi } from "vitest"

import type { ReadyActionContext } from "../../actions/types"
import { handOverExercises } from "../../commands/handOverExercises"
import type Resources from "../../config/resources"
import { idOfMoocExercise } from "../fixtures/identifiers"
import { createMockActionContext } from "../mocks/actionContext"
import { createDialogMock } from "../mocks/dialog"
import { makeTmpDirs } from "../utils"

function setUp(answer: boolean | undefined): {
  context: ReadyActionContext
  projectsDirectory: string
} {
  const root = makeTmpDirs({ "vscode/mooc/course/exercise/src/main.py": "student A's work" })
  const projectsDirectory = path.join(root, "vscode")
  const base = createMockActionContext({
    startup: {
      langs: {
        listLocalExercises: async () => Ok([]),
        listSettings: async () => Ok({}),
      } as never,
      resources: { projectsDirectory } as Resources,
      userData: { getCourses: () => [] } as never,
      workspaceManager: {
        getExercises: () => [{}],
        setExercises: async () => Ok.EMPTY,
      } as never,
    },
  })
  const [dialog] = createDialogMock()
  vi.mocked(dialog.choose).mockResolvedValue(answer as never)
  return { context: { ...base, dialog }, projectsDirectory }
}

suite("handOverExercises", function () {
  test("asks nothing of a login that follows no logout", async function () {
    const { context } = setUp(true)

    await handOverExercises(context)

    expect(context.dialog.choose).not.toHaveBeenCalled()
  })

  test("after a logout, moves the exercises aside for a student who says they are not theirs", async function () {
    const { context, projectsDirectory } = setUp(true)
    await context.startup.accountHandover.recordLogout()
    await context.startup.keptCopies.recordPaste(idOfMoocExercise("e1"), {
      fingerprint: "abc",
      link: "https://paste/1",
    })

    await handOverExercises(context)

    expect(fs.readdirSync(projectsDirectory)).toEqual([])
    const [moved] = fs
      .readdirSync(path.dirname(projectsDirectory))
      .filter((entry) => entry.startsWith("vscode-moved-"))
    expect(
      fs.readFileSync(
        path.join(path.dirname(projectsDirectory), moved ?? "", "mooc/course/exercise/src/main.py"),
        "utf8",
      ),
    ).toBe("student A's work")
    expect(context.startup.keptCopies.pasteLink(idOfMoocExercise("e1"), "abc")).toBeUndefined()
    // Asked once per logout.
    await handOverExercises(context)
    expect(context.dialog.choose).toHaveBeenCalledOnce()
  })

  test("leaves the exercises in place for a student who says they are theirs", async function () {
    const { context, projectsDirectory } = setUp(false)
    await context.startup.accountHandover.recordLogout()

    await handOverExercises(context)

    expect(fs.readdirSync(projectsDirectory)).toEqual(["mooc"])
  })
})
