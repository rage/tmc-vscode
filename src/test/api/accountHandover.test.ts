import { AccountHandover } from "../../api/accountHandover"
import { createMockMemento } from "../mocks/vscode"

suite("AccountHandover", function () {
  test("a recorded logout is taken once, also by a later instance over the same storage", async function () {
    const memento = createMockMemento()
    await new AccountHandover(memento).recordLogout()

    const later = new AccountHandover(memento)
    expect(await later.takeLogout()).toBe(true)
    expect(await later.takeLogout()).toBe(false)
  })
})
