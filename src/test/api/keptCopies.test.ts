import { KeptCopies } from "../../api/keptCopies"
import { idOfMoocExercise, idOfTmcExercise } from "../fixtures/identifiers"
import { createMockMemento } from "../mocks/vscode"

suite("KeptCopies", function () {
  test("survives a new instance over the same storage, as after a reload", async function () {
    const memento = createMockMemento()
    const id = idOfMoocExercise("e1")
    await new KeptCopies(memento).record(id, "backup", "abc")
    await new KeptCopies(memento).recordPaste(id, { fingerprint: "abc", link: "https://p/1" })

    const reloaded = new KeptCopies(memento)
    expect(reloaded.copyOf(id, "abc")).toBe("backup")
    expect(reloaded.pasteLink(id, "abc")).toBe("https://p/1")
  })

  test("keeps exercises of the two backends apart", async function () {
    const kept = new KeptCopies(createMockMemento())
    await kept.record(idOfTmcExercise(1), "submission", "abc")

    expect(kept.copyOf(idOfMoocExercise("1"), "abc")).toBeUndefined()
  })

  test("prefers naming a copy on the backend over the template", async function () {
    const kept = new KeptCopies(createMockMemento())
    const id = idOfMoocExercise("e1")
    await kept.record(id, "download", "abc")
    await kept.record(id, "submission", "abc")

    expect(kept.copyOf(id, "abc")).toBe("submission")
  })

  test("an unreadable state matches nothing, and clearing forgets everything", async function () {
    const kept = new KeptCopies(createMockMemento())
    const id = idOfMoocExercise("e1")
    await kept.record(id, "reset", undefined)
    expect(kept.copyOf(id, undefined)).toBeUndefined()

    await kept.record(id, "reset", "abc")
    await kept.recordPaste(id, { fingerprint: "abc", link: "https://p/1" })
    await kept.clear()

    expect(kept.copyOf(id, "abc")).toBeUndefined()
    expect(kept.pasteLink(id, "abc")).toBeUndefined()
  })
})
