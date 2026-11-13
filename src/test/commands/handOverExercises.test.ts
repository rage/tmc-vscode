import * as fs from "fs"
import * as path from "path"

import { Ok } from "ts-results"
import { vi } from "vitest"

import type { ReadyActionContext } from "../../actions/types"
import { handOverExercises } from "../../commands/handOverExercises"
import type Resources from "../../config/resources"
import { submissionViews } from "../../ui/submissionViews"
import { idOfMoocExercise } from "../fixtures/identifiers"
import { createMockActionContext } from "../mocks/actionContext"
import { createDialogMock } from "../mocks/dialog"
import { makeTmpDirs } from "../utils"

function setUp(
  loggedInAs: string | undefined,
  answer: boolean | undefined,
): { context: ReadyActionContext; projectsDirectory: string } {
  const root = makeTmpDirs({ "vscode/mooc/course/exercise/src/main.py": "student A's work" })
  const projectsDirectory = path.join(root, "vscode")
  const base = createMockActionContext({
    startup: {
      langs: {
        getMoocAccountId: vi.fn(async () => Ok(loggedInAs)),
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
  test("the first login records its account as the exercises' owner, asking nothing", async function () {
    const { context } = setUp("user-a", true)

    await handOverExercises(context)

    expect(context.dialog.choose).not.toHaveBeenCalled()
    expect(context.startup.accountHandover.exercisesAccountIds).toEqual(["user-a"])
  })

  test("the same account logging in again is asked nothing", async function () {
    const { context } = setUp("user-a", true)
    await context.startup.accountHandover.setExercisesAccountIds(["user-a"])

    await handOverExercises(context)

    expect(context.dialog.choose).not.toHaveBeenCalled()
  })

  test("another account can move the previous one's exercises aside, and its panels close", async function () {
    const { context, projectsDirectory } = setUp("user-b", true)
    await context.startup.accountHandover.setExercisesAccountIds(["user-a"])
    await context.startup.keptCopies.recordPaste(idOfMoocExercise("e1"), {
      fingerprint: "abc",
      link: "https://paste/1",
    })
    const cleared = vi.fn()
    const subscription = submissionViews.onDidClear(cleared)
    onTestFinished(() => subscription.dispose())

    await handOverExercises(context)

    expect(cleared).toHaveBeenCalledOnce()
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
    expect(context.startup.accountHandover.exercisesAccountIds).toEqual(["user-b"])
  })

  test("another account may keep the exercises, which stay the first one's too", async function () {
    const { context, projectsDirectory } = setUp("user-b", false)
    await context.startup.accountHandover.setExercisesAccountIds(["user-a"])

    await handOverExercises(context)

    expect(fs.readdirSync(projectsDirectory)).toEqual(["mooc"])
    expect(context.startup.accountHandover.exercisesAccountIds).toEqual(["user-a", "user-b"])
  })

  test("the first account logging in again after another kept the exercises is asked nothing", async function () {
    const { context } = setUp("user-a", true)
    await context.startup.accountHandover.setExercisesAccountIds(["user-a", "user-b"])

    await handOverExercises(context)

    expect(context.dialog.choose).not.toHaveBeenCalled()
  })

  test("exercises moved aside come back when their account logs in again", async function () {
    const { context, projectsDirectory } = setUp("user-b", true)
    await context.startup.accountHandover.setExercisesAccountIds(["user-a"])
    await handOverExercises(context)
    expect(fs.readdirSync(projectsDirectory)).toEqual([])
    vi.mocked(context.startup.langs.getMoocAccountId).mockResolvedValue(Ok("user-a"))
    vi.mocked(context.dialog.choose).mockClear()
    context.startup.workspaceManager.getExercises = () => []

    await handOverExercises(context)

    expect(context.dialog.choose).not.toHaveBeenCalled()
    expect(
      fs.readFileSync(path.join(projectsDirectory, "mooc/course/exercise/src/main.py"), "utf8"),
    ).toBe("student A's work")
    expect(context.startup.accountHandover.movedAside).toEqual([])
    expect(context.startup.accountHandover.exercisesAccountIds).toEqual(["user-a"])
    expect(context.dialog.notification).toHaveBeenLastCalledWith(
      "Brought back your exercises that another login moved aside.",
    )
  })

  test("exercises moved aside stay where they are while the exercises folder has files", async function () {
    const { context, projectsDirectory } = setUp("user-b", true)
    await context.startup.accountHandover.setExercisesAccountIds(["user-a"])
    await handOverExercises(context)
    fs.writeFileSync(path.join(projectsDirectory, "notes.txt"), "user-b's")
    vi.mocked(context.startup.langs.getMoocAccountId).mockResolvedValue(Ok("user-a"))
    context.startup.workspaceManager.getExercises = () => []

    await handOverExercises(context)

    expect(fs.readdirSync(projectsDirectory)).toEqual(["notes.txt"])
    const [moved] = context.startup.accountHandover.movedAside
    expect(moved?.accountIds).toEqual(["user-a"])
    expect(fs.existsSync(path.join(moved?.folder ?? "", "mooc"))).toBe(true)
    expect(vi.mocked(context.dialog.notification).mock.lastCall?.[0]).toContain(moved?.folder)
  })

  test("a dismissed question is asked again at the next login", async function () {
    const { context } = setUp("user-b", undefined)
    await context.startup.accountHandover.setExercisesAccountIds(["user-a"])

    await handOverExercises(context)

    expect(context.startup.accountHandover.exercisesAccountIds).toEqual(["user-a"])
  })

  test("an account courses.mooc.fi could not name changes nothing", async function () {
    const { context } = setUp(undefined, true)
    await context.startup.accountHandover.setExercisesAccountIds(["user-a"])

    await handOverExercises(context)

    expect(context.dialog.choose).not.toHaveBeenCalled()
    expect(context.startup.accountHandover.exercisesAccountIds).toEqual(["user-a"])
  })
})
