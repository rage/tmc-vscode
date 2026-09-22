import { isReady } from "../../actions/types"
import { createDegradedContext, createMockActionContext } from "./actionContext"

suite("the mock action context", () => {
  // Auto-mocking the context wholesale would make `startup.kind` a truthy `vi.fn()`, so
  // every narrowing would fail and no ready-only code path would ever be reached.
  test("its default is a startup every narrowing accepts", () => {
    expect(isReady(createMockActionContext())).toBe(true)
  })

  test("a degraded context reaches the failed-activation arm", () => {
    const failure = new Error("resource initialization failed")
    const context = createDegradedContext({ failures: { resources: failure } })
    expect(isReady(context)).toBe(false)
    expect(context.startup).toEqual({ kind: "degraded", failures: { resources: failure } })
  })

  test("a service the test drives replaces the auto-mock", () => {
    const userData = { getCourses: () => [] } as never
    expect(createMockActionContext({ startup: { userData } }).startup.userData).toBe(userData)
  })
})
