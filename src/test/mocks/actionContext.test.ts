import { refreshLocalExercises } from "../../actions/refreshLocalExercises"
import { InitializationError } from "../../errors"
import { createMockActionContext } from "./actionContext"

suite("the mock action context", () => {
  test("its services report success unambiguously", () => {
    // An auto-mocked `Result` answers both `.ok` and `.err` truthy, which silently
    // makes every initialization guard in every action untestable.
    const context = createMockActionContext()
    for (const service of [
      context.exerciseDecorationProvider,
      context.langs,
      context.resources,
      context.userData,
      context.workspaceManager,
    ]) {
      expect(service.ok).toBe(true)
      expect(service.err).toBe(false)
    }
  })

  test("a degraded service reaches an action's initialization-failure arm", async () => {
    const result = await refreshLocalExercises(createMockActionContext({ langs: "err" }))
    expect(result.err).toBe(true)
    expect(result.val).toBeInstanceOf(InitializationError)
  })
})
