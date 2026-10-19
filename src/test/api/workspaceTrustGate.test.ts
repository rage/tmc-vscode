import { vi } from "vitest"
import * as vscode from "vscode"

import { WorkspaceTrustGate } from "../../api/workspaceTrustGate"
import { WorkspaceUntrustedError } from "../../errors"

const grantTrust = (): void =>
  (
    vscode.workspace as unknown as { grantWorkspaceTrustForTest: () => void }
  ).grantWorkspaceTrustForTest()

suite("WorkspaceTrustGate", function () {
  let isTrusted: boolean
  let now: number
  let gate: WorkspaceTrustGate

  beforeEach(function () {
    isTrusted = false
    now = 0
    gate = new WorkspaceTrustGate(
      () => isTrusted,
      () => now,
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
})
