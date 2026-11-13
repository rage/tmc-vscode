import { AccountHandover } from "../../api/accountHandover"
import { createMockMemento } from "../mocks/vscode"

suite("AccountHandover", function () {
  test("a later instance over the same storage knows whose the exercises are", async function () {
    const memento = createMockMemento()
    expect(new AccountHandover(memento).exercisesAccountId).toBeUndefined()

    await new AccountHandover(memento).setExercisesAccountId("user-a")

    expect(new AccountHandover(memento).exercisesAccountId).toBe("user-a")
  })
})
