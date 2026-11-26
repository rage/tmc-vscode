import type { Result } from "ts-results"
import { Err, Ok } from "ts-results"
import { vi } from "vitest"
import * as vscode from "vscode"

import type { MoocDeviceLogin } from "../../../shared/langsSchema"
import type { BaseError, LoginPanel, LoginView } from "../../../shared/lib"
import type { ReadyActionContext } from "../../actions/types"
import type Langs from "../../api/langs"
import { handOverExercises } from "../../commands/handOverExercises"
import { login } from "../../commands/login"
import { refreshEverything } from "../../commands/refreshEverything"
import {
  AuthorizationError,
  ConnectionError,
  DeviceLoginDeniedError,
  DeviceLoginExpiredError,
  ServerError,
} from "../../errors"
import { loginScreens } from "../../ui/loginScreens"
import { Logger } from "../../utilities"
import { tmcLocalCourse } from "../fixtures/courses"
import { createMockActionContext } from "../mocks/actionContext"
import { createDialogMock } from "../mocks/dialog"

vi.mock("../../commands/handOverExercises", () => ({
  handOverExercises: vi.fn(async () => {}),
}))

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

const NOW = new Date("2026-11-16T10:00:00Z")

/** One `mooc login` process the test drives: it emits the code and ends when told to. */
interface FakeLogin {
  emitCode: (info?: MoocDeviceLogin) => void
  finish: (result: Result<void, BaseError>) => void
  interrupt: ReturnType<typeof vi.fn>
}

interface Harness {
  context: ReadyActionContext
  logins: FakeLogin[]
  /** The screens the logins opened, newest last. */
  opened: LoginPanel[]
  /** Every view sent to a screen, oldest first. */
  views: { panelId: number; view: LoginView }[]
  /** The screens a login asked to close. */
  closed: number[]
  openExternal: ReturnType<typeof vi.fn>
}

function harness(): Harness {
  const logins: FakeLogin[] = []
  const authenticate = vi.fn((onDeviceCode: (info: MoocDeviceLogin) => void) => {
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
    ...createMockActionContext({ startup: { langs: { authenticate } as unknown as Langs } }),
    dialog,
  }
  vi.mocked(context.startup.userData.getCourses).mockReturnValue([])
  vi.mocked(context.startup.workspaceManager.getExercises).mockReturnValue([])

  const opened: LoginPanel[] = []
  const views: Harness["views"] = []
  const closed: number[] = []
  const subscriptions = vscode.Disposable.from(
    loginScreens.onDidOpen((panel) => {
      opened.push(panel)
      const view = loginScreens.latestView(panel.id)
      if (view) {
        views.push({ panelId: panel.id, view })
      }
    }),
    loginScreens.onDidUpdate(({ panel, view }) => views.push({ panelId: panel.id, view })),
    loginScreens.onDidRequestClose((panel) => closed.push(panel.id)),
  )
  onTestFinished(() => subscriptions.dispose())

  const openExternal = vi.fn(async () => true)
  const vscodeModule: object = vscode
  Object.defineProperty(vscodeModule, "env", {
    value: { clipboard: { writeText: vi.fn(async () => {}) }, openExternal },
    writable: true,
    configurable: true,
  })

  return { context, logins, opened, views, closed, openExternal }
}

/** Lets the login's awaits between two steps run. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve()
  }
}

/** Starts a login and lets the CLI emit `info`; the login's outcome stays pending. */
async function runToCode(
  h: Harness,
  info: MoocDeviceLogin = DEVICE,
): Promise<{ outcome: Promise<unknown>; panel: LoginPanel }> {
  const outcome = login(h.context)
  await settle()
  h.logins.at(-1)?.emitCode(info)
  await settle()
  return { outcome, panel: h.opened.at(-1) as LoginPanel }
}

function lastView(h: Harness): LoginView | undefined {
  return h.views.at(-1)?.view
}

function openedUrl(h: Harness): string | undefined {
  return (h.openExternal.mock.calls[0]?.[0] as vscode.Uri | undefined)?.toString(true)
}

/** Puts `tabs` in the one editor group, `activeTab` shown; returns what undoes it. */
function showTabs(
  tabs: { label: string; input: unknown }[],
  activeTab: { label: string; input: unknown } | undefined = tabs[0],
): () => void {
  const initialTabGroups = vscode.window.tabGroups
  Object.defineProperty(vscode.window, "tabGroups", {
    value: { all: [{ tabs, activeTab }] },
    configurable: true,
  })
  return () =>
    Object.defineProperty(vscode.window, "tabGroups", {
      value: initialTabGroups,
      configurable: true,
    })
}

suite("login command", function () {
  beforeEach(function () {
    vi.mocked(vscode.commands.executeCommand).mockClear()
  })

  afterEach(function () {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  test("shows the login screen at once, then the code with its page and expiry", async function () {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] })
    const h = harness()
    const outcome = login(h.context)

    expect(h.opened).toEqual([{ id: expect.any(Number), type: "Login", isAddingCourse: false }])
    expect(lastView(h)).toEqual({ phase: "requestingCode" })

    await settle()
    h.logins[0]?.emitCode()
    await settle()
    expect(lastView(h)).toEqual({
      phase: "waiting",
      userCode: "WXYZ-1234",
      verificationUrl: DEVICE.verification_uri,
      expiresAt: "2026-11-16T10:15:00.000Z",
    })
    // The student opens the page from the screen, after seeing the code.
    expect(h.openExternal).not.toHaveBeenCalled()

    h.logins[0]?.finish(Ok(undefined))
    expect(await outcome).toBe("loggedIn")
  })

  test("Open on the screen opens the page carrying the code", async function () {
    const h = harness()
    const { panel } = await runToCode(h)

    loginScreens.requestAction(panel.id, "openVerificationPage")
    await settle()

    expect(openedUrl(h)).toBe(DEVICE.verification_uri_complete)
  })

  test("without a page carrying the code, Open opens the one it is typed into", async function () {
    const h = harness()
    const { panel } = await runToCode(h, { ...DEVICE, verification_uri_complete: null })

    loginScreens.requestAction(panel.id, "openVerificationPage")
    await settle()

    expect(openedUrl(h)).toBe(DEVICE.verification_uri)
  })

  test("an action from an older login's screen does nothing", async function () {
    const h = harness()
    const { panel } = await runToCode(h)

    loginScreens.requestAction(panel.id + 1000, "openVerificationPage")
    loginScreens.requestAction(panel.id + 1000, "cancel")
    await settle()

    expect(h.openExternal).not.toHaveBeenCalled()
    expect(h.logins[0]?.interrupt).not.toHaveBeenCalled()
  })

  test("a browser that does not open leaves the login waiting, logged without its code", async function () {
    const warn = vi.spyOn(Logger, "warn").mockImplementation(() => {})
    const h = harness()
    h.openExternal.mockResolvedValue(false)
    const { outcome, panel } = await runToCode(h)

    loginScreens.requestAction(panel.id, "openVerificationPage")
    await vi.waitFor(() => expect(warn).toHaveBeenCalled())

    expect(JSON.stringify(warn.mock.calls)).not.toContain("WXYZ-1234")
    expect(h.logins[0]?.interrupt).not.toHaveBeenCalled()
    h.logins[0]?.finish(Ok(undefined))
    expect(await outcome).toBe("loggedIn")
  })

  test("never opens a verification page that is not http(s)", async function () {
    const h = harness()
    const { panel } = await runToCode(h, {
      ...DEVICE,
      verification_uri_complete: "command:workbench.action.quit",
    })

    loginScreens.requestAction(panel.id, "openVerificationPage")
    await settle()

    expect(h.openExternal).not.toHaveBeenCalled()
    expect(h.logins[0]?.interrupt).not.toHaveBeenCalled()
  })

  test("Cancel kills the CLI process and closes the screen, silently", async function () {
    const h = harness()
    const { outcome, panel } = await runToCode(h)

    loginScreens.requestAction(panel.id, "cancel")

    expect(await outcome).toBe("cancelled")
    expect(h.logins[0]?.interrupt).toHaveBeenCalled()
    expect(h.closed).toEqual([panel.id])
    expect(h.context.dialog.errorNotification).not.toHaveBeenCalled()
    expect(lastView(h)?.phase).toBe("waiting")
  })

  test("closing the screen cancels its login, and no code arriving later is shown", async function () {
    const h = harness()
    const outcome = login(h.context)
    await settle()
    const panel = h.opened[0] as LoginPanel

    loginScreens.leave(panel.id + 1000)
    await settle()
    expect(h.logins[0]?.interrupt).not.toHaveBeenCalled()

    loginScreens.leave(panel.id)
    h.logins[0]?.emitCode()
    expect(await outcome).toBe("cancelled")
    expect(h.logins[0]?.interrupt).toHaveBeenCalled()
    await settle()
    expect(lastView(h)).toEqual({ phase: "requestingCode" })
  })

  test("showing another screen in its place keeps the login waiting", async function () {
    const h = harness()
    const { outcome, panel } = await runToCode(h)

    loginScreens.leave(panel.id, false)
    await settle()
    expect(h.logins[0]?.interrupt).not.toHaveBeenCalled()

    h.logins[0]?.finish(Ok(undefined))
    expect(await outcome).toBe("loggedIn")
  })

  test("with no course added, a login goes on to the add-course screen", async function () {
    const h = harness()
    const { outcome } = await runToCode(h)

    h.logins[0]?.finish(Ok(undefined))

    expect(await outcome).toBe("loggedIn")
    expect(lastView(h)).toEqual({ phase: "loggedIn" })
    expect(h.context.dialog.statusMessage).toHaveBeenCalledWith("Logged in.")
    expect(h.context.dialog.notification).not.toHaveBeenCalled()
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith("tmc.showAddCourse")
    expect(h.closed).toEqual([])
    expect(refreshEverything).toHaveBeenCalledWith(h.context, { silent: true })
    expect(handOverExercises).toHaveBeenCalledWith(h.context)
  })

  test("a login with courses added closes its screen and goes to no add-course screen", async function () {
    const h = harness()
    vi.mocked(h.context.startup.userData.getCourses).mockReturnValue([tmcLocalCourse()])
    const { outcome, panel } = await runToCode(h)

    h.logins[0]?.finish(Ok(undefined))

    expect(await outcome).toBe("loggedIn")
    expect(h.closed).toEqual([panel.id])
    expect(h.context.dialog.statusMessage).toHaveBeenCalledExactlyOnceWith("Logged in.")
    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith("tmc.showAddCourse")
  })

  test("a login started to add a course goes on to the add-course screen anyway", async function () {
    const h = harness()
    vi.mocked(h.context.startup.userData.getCourses).mockReturnValue([tmcLocalCourse()])
    const outcome = login(h.context, { isAddingCourse: true })
    await settle()

    expect(h.opened[0]?.isAddingCourse).toBe(true)
    h.logins[0]?.finish(Ok(undefined))
    expect(await outcome).toBe("loggedIn")
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith("tmc.showAddCourse")
    expect(h.closed).toEqual([])
  })

  test("a login with courses moves a shown walkthrough on, but not one behind code", async function () {
    for (const [activeTab, isMoved] of [
      [{ label: "Welcome", input: undefined }, true],
      [{ label: "main.py", input: {} }, false],
    ] as const) {
      vi.mocked(vscode.commands.executeCommand).mockClear()
      const h = harness()
      vi.mocked(h.context.startup.userData.getCourses).mockReturnValue([tmcLocalCourse()])
      const restore = showTabs([{ label: "Welcome", input: undefined }, activeTab], activeTab)
      try {
        const { outcome } = await runToCode(h)
        h.logins[0]?.finish(Ok(undefined))
        expect(await outcome).toBe("loggedIn")
      } finally {
        restore()
      }

      const moves = vi
        .mocked(vscode.commands.executeCommand)
        .mock.calls.filter(([command]) => command === "workbench.action.openWalkthrough")
      expect(moves).toHaveLength(isMoved ? 1 : 0)
    }
  })

  test.each([
    [new DeviceLoginDeniedError("denied"), "denied", "The login was denied in the browser."],
    [
      new DeviceLoginExpiredError("expired"),
      "expired",
      "The login code expired before it was approved.",
    ],
  ])("shows %s on the screen, with no logs to offer", async function (error, failure, message) {
    const h = harness()
    const { outcome } = await runToCode(h)

    h.logins[0]?.finish(Err(error))

    expect(await outcome).toBe("failed")
    expect(lastView(h)).toEqual({ phase: "failed", failure, error: { message } })
    expect(h.context.dialog.errorNotification).not.toHaveBeenCalled()
    expect(h.closed).toEqual([])
  })

  test("shows an unreachable server on the screen with its details, before any code arrives", async function () {
    const h = harness()
    const outcome = login(h.context)
    await settle()

    h.logins[0]?.finish(Err(new ConnectionError("dns error")))

    expect(await outcome).toBe("failed")
    expect(lastView(h)).toEqual({
      phase: "failed",
      failure: "unreachable",
      error: {
        message: "Could not reach the server. Check your internet connection.",
        detailsId: expect.any(String),
      },
    })
    expect(h.context.dialog.errorNotification).not.toHaveBeenCalled()
  })

  test("shows a server error status as the server failing, not the connection", async function () {
    const h = harness()
    const outcome = login(h.context)
    await settle()
    const error = Object.assign(new ServerError("HTTP error 503 …"), {
      httpStatus: 503,
      backend: "mooc" as const,
    })

    h.logins[0]?.finish(Err(error))

    expect(await outcome).toBe("failed")
    const view = lastView(h)
    expect(view?.phase === "failed" && view.failure).toBe("serverError")
    expect(view?.phase === "failed" && view.error.message).toBe(
      "The server ran into a problem. Try again later.",
    )
  })

  test("a new login cancels the one in flight, which then shows nothing more", async function () {
    const h = harness()
    const { outcome: first, panel: firstPanel } = await runToCode(h)

    const second = login(h.context)
    await settle()

    expect(await first).toBe("cancelled")
    expect(h.logins[0]?.interrupt).toHaveBeenCalled()
    expect(h.logins).toHaveLength(2)
    expect(h.opened).toHaveLength(2)
    expect(h.views.filter(({ panelId }) => panelId === firstPanel.id).at(-1)?.view.phase).toBe(
      "waiting",
    )
    h.logins[1]?.finish(Ok(undefined))
    expect(await second).toBe("loggedIn")
  })
})
