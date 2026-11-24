import { vi } from "vitest"
import * as vscode from "vscode"

import { LOGGED_OUT_MESSAGE } from "../../../shared/lib"
import Dialog from "../../api/dialog"
import { AccountStatusBarItem, showAccountMenu } from "../../ui/statusBarAccount"
import { fakeStatusBarItems, tooltipText } from "../mocks/statusBar"

function create(isLoggedIn: boolean): {
  account: AccountStatusBarItem
  item: ReturnType<typeof fakeStatusBarItems>[number]
} {
  const items = fakeStatusBarItems()
  const account = new AccountStatusBarItem({
    loggedIn: isLoggedIn,
    isSessionExpired: false,
    session: isLoggedIn ? { kind: "mooc" } : undefined,
  })
  const [item] = items
  if (!item) {
    throw new Error("no status bar item was created")
  }
  return { account, item }
}

/** The item's text for each state it can show. */
const shown = {
  loggedIn: "$(account) MOOC.fi",
  loggedOut: "$(sign-in) TestMyCode: Log In",
  sessionExpired: "$(warning) TestMyCode: Logged Out",
}

suite("AccountStatusBarItem", function () {
  afterEach(function () {
    vi.restoreAllMocks()
  })

  test("is a named, always shown item on the left", function () {
    const { item } = create(false)

    expect(item.id).toBe("tmc.account")
    expect(item.alignment).toBe(vscode.StatusBarAlignment.Left)
    expect(item.name).toBe("TestMyCode Account")
    expect(item.isShown).toBe(true)
  })

  test("logged out, it logs in", function () {
    const { item } = create(false)

    expect(item.text).toBe(shown.loggedOut)
    expect(item.text).toBe("$(sign-in) TestMyCode: Log In")
    expect(item.command).toBe("tmc.showMoocLogin")
    expect(item.accessibilityInformation?.label).toContain("not logged in")
    expect(tooltipText(item)).toContain("Not logged in")
  })

  test("logged in, it offers the account actions", function () {
    const { item } = create(true)

    expect(item.text).toBe(shown.loggedIn)
    expect(item.text).toBe("$(account) MOOC.fi")
    expect(item.command).toBe("tmc.showAccountMenu")
    expect(item.accessibilityInformation?.label).toContain("logged in with your MOOC.fi account")
  })

  test("follows logins and logouts", function () {
    const { account, item } = create(false)

    account.update({ loggedIn: true, isSessionExpired: false, session: undefined })
    expect(item.text).toBe(shown.loggedIn)
    account.update({ loggedIn: false, isSessionExpired: false, session: undefined })
    expect(item.text).toBe(shown.loggedOut)
    expect(item.command).toBe("tmc.showMoocLogin")
  })

  test("an expired session says so, in the words the course home uses", function () {
    const { account, item } = create(true)

    account.update({ loggedIn: false, isSessionExpired: true, session: undefined })
    expect(item.text).toBe(shown.sessionExpired)
    expect(item.text).toBe("$(warning) TestMyCode: Logged Out")
    expect(item.command).toBe("tmc.showMoocLogin")
    expect(tooltipText(item)).toContain(LOGGED_OUT_MESSAGE)
  })

  test("names the account courses.mooc.fi named", function () {
    const { account, item } = create(true)

    account.update({
      loggedIn: true,
      isSessionExpired: false,
      session: { kind: "mooc", account: { id: "a", name: "Ada", email: "ada@example.com" } },
    })

    expect(tooltipText(item)).toContain("Ada (ada@example.com)")
    expect(item.accessibilityInformation?.label).toContain("logged in as Ada (ada@example.com)")
  })

  test("an old tmc.mooc.fi login is shown as one, offering the MOOC.fi login", function () {
    const { account, item } = create(true)

    account.update({ loggedIn: true, isSessionExpired: false, session: { kind: "tmc" } })

    expect(item.text).toBe("$(account) tmc.mooc.fi")
    expect(item.command).toBe("tmc.showMoocLogin")
  })

  test("disposes its item", function () {
    const { account, item } = create(true)

    account.dispose()

    expect(item.isDisposed).toBe(true)
  })
})

suite("showAccountMenu", function () {
  afterEach(function () {
    vi.restoreAllMocks()
  })

  test("runs the picked action", async function () {
    const executeCommand = vi.spyOn(vscode.commands, "executeCommand").mockResolvedValue(undefined)
    vi.spyOn(vscode.window, "showQuickPick").mockImplementation((async (
      items: readonly { label: string }[],
    ) => items.find((x) => x.label.includes("Log Out"))) as never)

    await showAccountMenu(new Dialog())

    expect(executeCommand).toHaveBeenCalledWith("tmc.logout")
  })

  test("names the Courses view entry after the view", async function () {
    const executeCommand = vi.spyOn(vscode.commands, "executeCommand").mockResolvedValue(undefined)
    vi.spyOn(vscode.window, "showQuickPick").mockImplementation((async (
      items: readonly { label: string }[],
    ) => items.find((x) => x.label === "$(book) Show Courses")) as never)

    await showAccountMenu(new Dialog())

    expect(executeCommand).toHaveBeenCalledWith("tmc.myCourses")
  })

  test("does nothing when dismissed", async function () {
    const executeCommand = vi.spyOn(vscode.commands, "executeCommand").mockResolvedValue(undefined)
    vi.spyOn(vscode.window, "showQuickPick").mockResolvedValue(undefined)

    await showAccountMenu(new Dialog())

    expect(executeCommand).not.toHaveBeenCalled()
  })
})
