import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
import { vi } from "vitest"
import * as vscode from "vscode"

import type { ReadyActionContext } from "../../actions/types"
import type Langs from "../../api/langs"
import { login } from "../../commands/login"
import { refreshEverything } from "../../commands/refreshEverything"
import { AuthorizationError, ConnectionError } from "../../errors"
import type { MoocDeviceLogin } from "../../shared/langsSchema"
import type { BaseError } from "../../shared/shared"
import { createMockActionContext } from "../mocks/actionContext"
import { createDialogMock } from "../mocks/dialog"

vi.mock("../../commands/refreshEverything", () => ({
  refreshEverything: vi.fn(async () => Ok.EMPTY),
}))

const DEVICE: MoocDeviceLogin = {
  user_code: "WXYZ-1234",
  verification_uri: "https://courses.mooc.fi/oauth_device",
  verification_uri_complete: "https://courses.mooc.fi/oauth_device?user_code=WXYZ-1234",
  expires_in: 900,
  interval: 5,
}

const COPY_AND_OPEN = "Copy & Open courses.mooc.fi"

/** One `mooc login` process the test drives: it emits the code and ends when told to. */
interface FakeLogin {
  emitCode: (info?: MoocDeviceLogin) => void
  finish: (result: Result<void, BaseError>) => void
  interrupt: ReturnType<typeof vi.fn>
}

interface Harness {
  context: ReadyActionContext
  logins: FakeLogin[]
  progressMessages: string[]
  cancelProgress: () => void
  clipboard: ReturnType<typeof vi.fn>
  openExternal: ReturnType<typeof vi.fn>
  /** Answers the code modal: a button label presses that button, undefined dismisses it. */
  answerModal: (answer: string | undefined) => void
}

function harness(): Harness {
  const logins: FakeLogin[] = []
  const authenticateMooc = vi.fn((onDeviceCode: (info: MoocDeviceLogin) => void) => {
    const result = Promise.withResolvers<Result<void, BaseError>>()
    const interrupt = vi.fn(() => result.resolve(Err(new AuthorizationError("interrupted"))))
    logins.push({
      emitCode: (info = DEVICE) => onDeviceCode(info),
      finish: result.resolve,
      interrupt,
    })
    return { result: result.promise, interrupt }
  })
  const [dialog] = createDialogMock()
  const context = {
    ...createMockActionContext({ startup: { langs: { authenticateMooc } as unknown as Langs } }),
    dialog,
  }

  const progressMessages: string[] = []
  const progressCancellation = new vscode.CancellationTokenSource()
  vi.spyOn(vscode.window, "withProgress").mockImplementation(((
    _options: unknown,
    task: (
      progress: { report: (value: { message?: string }) => void },
      token: vscode.CancellationToken,
    ) => Promise<unknown>,
  ) =>
    task(
      { report: ({ message }): void => void (message && progressMessages.push(message)) },
      progressCancellation.token,
    )) as unknown as typeof vscode.window.withProgress)

  let modal = Promise.withResolvers<string | undefined>()
  vi.spyOn(vscode.window, "showInformationMessage").mockImplementation((() => {
    modal = Promise.withResolvers<string | undefined>()
    return modal.promise
  }) as unknown as typeof vscode.window.showInformationMessage)

  const clipboard = vi.fn(async () => {})
  const openExternal = vi.fn(async () => true)
  const vscodeModule: object = vscode
  Object.defineProperty(vscodeModule, "env", {
    value: { clipboard: { writeText: clipboard }, openExternal },
    writable: true,
    configurable: true,
  })

  return {
    context,
    logins,
    progressMessages,
    cancelProgress: () => progressCancellation.cancel(),
    clipboard,
    openExternal,
    answerModal: (answer) => modal.resolve(answer),
  }
}

/** Lets the login's awaits between two steps run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve()
  }
}

/** Starts a login and lets the CLI emit its code; the login's outcome stays pending. */
async function runToModal(h: Harness): Promise<{ outcome: Promise<unknown> }> {
  const outcome = login(h.context)
  await settle()
  h.logins[0]?.emitCode()
  await settle()
  return { outcome }
}

function openedUrl(h: Harness): string | undefined {
  return (h.openExternal.mock.calls[0]?.[0] as vscode.Uri | undefined)?.toString(true)
}

function errorNotificationCall(context: ReadyActionContext): unknown[] | undefined {
  return vi.mocked(context.dialog.errorNotification).mock.calls[0]
}

suite("login command", function () {
  afterEach(function () {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  test("shows the code, then copies it and opens the page on Copy & Open", async function () {
    const h = harness()
    const { outcome } = await runToModal(h)

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      "Your courses.mooc.fi login code is WXYZ-1234",
      {
        modal: true,
        detail: "Check that the page that opens shows this code, then approve the login.",
      },
      COPY_AND_OPEN,
    )
    h.answerModal(COPY_AND_OPEN)
    await settle()

    expect(h.clipboard).toHaveBeenCalledExactlyOnceWith("WXYZ-1234")
    expect(h.openExternal).toHaveBeenCalledOnce()
    expect(openedUrl(h)).toBe(DEVICE.verification_uri_complete)
    expect(h.progressMessages.at(-1)).toBe(
      "Waiting for you to approve in the browser… Code WXYZ-1234 at https://courses.mooc.fi/oauth_device",
    )

    h.logins[0]?.finish(Ok(undefined))
    expect(await outcome).toBe("loggedIn")
    expect(h.context.dialog.notification).toHaveBeenCalledWith("Logged in to courses.mooc.fi.", [
      "Add new course",
      expect.any(Function),
    ])
    expect(refreshEverything).toHaveBeenCalledWith(h.context, { silent: true })
  })

  test("the progress shows the code, not the request for it, while the code modal is open", async function () {
    const h = harness()
    await runToModal(h)

    expect(h.progressMessages.at(-1)).toBe(
      "Waiting for you to approve in the browser… Code WXYZ-1234 at https://courses.mooc.fi/oauth_device",
    )
  })

  test("opens the plain verification page when the CLI has no complete one", async function () {
    const h = harness()
    const outcome = login(h.context)
    await settle()
    h.logins[0]?.emitCode({ ...DEVICE, verification_uri_complete: null })
    await settle()

    expect(vi.mocked(vscode.window.showInformationMessage).mock.calls[0]?.[1]).toMatchObject({
      detail: "Paste the code on the page that opens, then approve the login.",
    })
    h.answerModal(COPY_AND_OPEN)
    await settle()
    expect(openedUrl(h)).toBe(DEVICE.verification_uri)

    h.logins[0]?.finish(Ok(undefined))
    expect(await outcome).toBe("loggedIn")
  })

  test("dismissing the code cancels the login silently", async function () {
    const h = harness()
    const { outcome } = await runToModal(h)

    h.answerModal(undefined)

    expect(await outcome).toBe("cancelled")
    expect(h.logins[0]?.interrupt).toHaveBeenCalled()
    expect(h.openExternal).not.toHaveBeenCalled()
    expect(h.context.dialog.errorNotification).not.toHaveBeenCalled()
    expect(h.context.dialog.notification).not.toHaveBeenCalled()
  })

  test("cancelling the progress notification kills the CLI process", async function () {
    const h = harness()
    const { outcome } = await runToModal(h)
    h.answerModal(COPY_AND_OPEN)
    await settle()

    h.cancelProgress()

    expect(await outcome).toBe("cancelled")
    expect(h.logins[0]?.interrupt).toHaveBeenCalled()
    expect(h.context.dialog.errorNotification).not.toHaveBeenCalled()
  })

  test("a login that ends while the code is still shown opens no browser", async function () {
    const h = harness()
    const { outcome } = await runToModal(h)

    h.logins[0]?.finish(Ok(undefined))
    await settle()
    h.answerModal(COPY_AND_OPEN)

    expect(await outcome).toBe("loggedIn")
    expect(h.openExternal).not.toHaveBeenCalled()
    expect(h.logins[0]?.interrupt).not.toHaveBeenCalled()
  })

  test.each([
    ["The device authorization request was denied", "The login was denied in the browser."],
    [
      "The device authorization request expired before it was approved",
      "The login code expired before it was approved.",
    ],
  ])("says what went wrong when %s, and offers Try again", async function (cliMessage, shown) {
    const h = harness()
    const { outcome } = await runToModal(h)
    h.answerModal(COPY_AND_OPEN)
    await settle()

    h.logins[0]?.finish(Err(new AuthorizationError(cliMessage)))

    expect(await outcome).toBe("failed")
    expect(errorNotificationCall(h.context)).toEqual([
      shown,
      undefined,
      ["Try again", expect.any(Function)],
    ])
    const executeCommand = vi.spyOn(vscode.commands, "executeCommand").mockResolvedValue(undefined)
    const [, , [, tryAgain]] = errorNotificationCall(h.context) as [
      string,
      undefined,
      [string, () => void],
    ]
    tryAgain()
    expect(executeCommand).toHaveBeenCalledWith("tmc.showMoocLogin")
  })

  test("reports an unreachable server with its logs, before any code arrives", async function () {
    const h = harness()
    const outcome = login(h.context)
    await settle()
    const error = new ConnectionError("dns error")

    h.logins[0]?.finish(Err(error))

    expect(await outcome).toBe("failed")
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled()
    expect(errorNotificationCall(h.context)).toEqual([
      "Could not reach courses.mooc.fi. Check your internet connection.",
      error,
      ["Try again", expect.any(Function)],
    ])
  })

  test("gives up on a CLI still running past the code's lifetime", async function () {
    vi.useFakeTimers()
    const h = harness()
    const { outcome } = await runToModal(h)
    h.answerModal(COPY_AND_OPEN)
    await settle()

    await vi.advanceTimersByTimeAsync(DEVICE.expires_in * 1000 + 30_000)

    expect(await outcome).toBe("failed")
    expect(h.logins[0]?.interrupt).toHaveBeenCalled()
    expect(errorNotificationCall(h.context)?.[0]).toBe(
      "The login code expired before it was approved.",
    )
  })

  test("a new login cancels the one in flight", async function () {
    const h = harness()
    const { outcome: first } = await runToModal(h)
    h.answerModal(COPY_AND_OPEN)
    await settle()

    const second = login(h.context)
    await settle()

    expect(await first).toBe("cancelled")
    expect(h.logins[0]?.interrupt).toHaveBeenCalled()
    expect(h.logins).toHaveLength(2)
    h.logins[1]?.finish(Ok(undefined))
    expect(await second).toBe("loggedIn")
  })
})
