import type { Mock } from "vitest"
import { vi } from "vitest"
import * as vscode from "vscode"

import type { RetryOffer } from "../../api/workspaceTrustGate"
import { WorkspaceTrustGate } from "../../api/workspaceTrustGate"
import { WorkspaceUntrustedError } from "../../errors"

const grantTrust = (): void =>
  (
    vscode.workspace as unknown as { grantWorkspaceTrustForTest: () => void }
  ).grantWorkspaceTrustForTest()

suite("WorkspaceTrustGate", function () {
  let isTrusted: boolean
  let now: number
  let ask: Mock<(offer: RetryOffer) => Promise<boolean>>
  let tell: Mock<(message: string) => void>
  let gate: WorkspaceTrustGate

  beforeEach(function () {
    isTrusted = false
    now = 0
    ask = vi.fn(async () => true)
    tell = vi.fn()
    gate = new WorkspaceTrustGate(
      () => isTrusted,
      () => now,
      ask,
      tell,
    )
  })

  afterEach(function () {
    gate.dispose()
  })

  test("lets everything through in a trusted window", function () {
    isTrusted = true
    const retry = vi.fn()

    expect(gate.refusal(retry)).toBeUndefined()
    grantTrust()
    expect(retry).not.toHaveBeenCalled()
  })

  test("refuses in Restricted Mode and retries once trust is granted", function () {
    const retry = vi.fn()

    expect(gate.refusal(retry)).toBeInstanceOf(WorkspaceUntrustedError)
    expect(retry).not.toHaveBeenCalled()

    grantTrust()
    grantTrust()
    expect(retry).toHaveBeenCalledTimes(1)
  })

  test("retries only the latest refused operation", function () {
    const earlier = vi.fn()
    const latest = vi.fn()
    gate.refusal(earlier)
    gate.refusal(latest)

    grantTrust()

    expect(earlier).not.toHaveBeenCalled()
    expect(latest).toHaveBeenCalledTimes(1)
  })

  // A test run the student asked for long ago starting by itself would be a surprise.
  test("does not retry a refusal that is minutes old", function () {
    const retry = vi.fn()
    gate.refusal(retry)
    now = 6 * 60 * 1000

    grantTrust()

    expect(retry).not.toHaveBeenCalled()
  })

  test("asks before retrying an operation refused with an offer", async function () {
    const retry = vi.fn()
    const offer = { message: "Submit hello?", action: "Submit", expiredMessage: "Expired." }
    gate.refusal(retry, offer)

    grantTrust()

    expect(ask).toHaveBeenCalledWith(offer)
    await vi.waitFor(() => expect(retry).toHaveBeenCalledTimes(1))
  })

  test("does not retry an offered operation the user does not accept", async function () {
    ask.mockResolvedValue(false)
    const retry = vi.fn()
    gate.refusal(retry, { message: "Submit hello?", action: "Submit", expiredMessage: "Expired." })

    grantTrust()

    await vi.waitFor(() => expect(ask).toHaveBeenCalledOnce())
    await Promise.resolve()
    expect(retry).not.toHaveBeenCalled()
  })

  test("an offer accepted minutes after it was asked retries nothing, and says so", async function () {
    const answer = Promise.withResolvers<boolean>()
    ask.mockReturnValue(answer.promise)
    const retry = vi.fn()
    gate.refusal(retry, { message: "Submit hello?", action: "Submit", expiredMessage: "Expired." })
    now = 60 * 1000

    grantTrust()
    now += 6 * 60 * 1000
    answer.resolve(true)

    await vi.waitFor(() => expect(tell).toHaveBeenCalledExactlyOnceWith("Expired."))
    expect(retry).not.toHaveBeenCalled()
  })
})
