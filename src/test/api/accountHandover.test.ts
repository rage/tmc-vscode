import { AccountHandover } from "../../api/accountHandover"
import { createMockMemento } from "../mocks/vscode"

suite("AccountHandover", function () {
  test("a later instance over the same storage knows whose the exercises are", async function () {
    const memento = createMockMemento()
    expect(new AccountHandover(memento).exercisesAccountIds).toEqual([])

    await new AccountHandover(memento).setExercisesAccountIds(["user-a"])
    await new AccountHandover(memento).addExercisesAccountId("user-b")
    await new AccountHandover(memento).addExercisesAccountId("user-b")

    expect(new AccountHandover(memento).exercisesAccountIds).toEqual(["user-a", "user-b"])
  })

  test("reads the one account an earlier version recorded", async function () {
    const memento = createMockMemento()
    await memento.update("exercisesAccountId", "user-a")

    expect(new AccountHandover(memento).exercisesAccountIds).toEqual(["user-a"])
  })

  test("remembers moved-aside folders until they are forgotten", async function () {
    const handover = new AccountHandover(createMockMemento())
    await handover.recordMovedAside({ folder: "/a", accountIds: ["user-a"] })
    await handover.recordMovedAside({ folder: "/b", accountIds: ["user-b"] })

    await handover.forgetMovedAside("/a")

    expect(handover.movedAside).toEqual([{ folder: "/b", accountIds: ["user-b"] }])
  })
})
