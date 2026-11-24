import type * as vscode from "vscode"

import { CorruptStoredDataError } from "../../errors"
import Storage from "../../storage"
import { v3 } from "../../storage/data"
import { Logger, LogLevel } from "../../utilities"
import * as sessionState from "../fixtures/sessionState"
import * as userData from "../fixtures/userData"
import { createMockContext } from "../mocks/vscode"

suite("Storage reads", function () {
  let context: vscode.ExtensionContext
  let storage: Storage

  beforeEach(function () {
    Logger.configure(LogLevel.Verbose)
    context = createMockContext()
    storage = new Storage(context.globalState)
  })

  test("reports nothing stored as nothing stored", function () {
    expect(storage.getUserData()).toBeUndefined()
    expect(storage.getSessionState()).toBeUndefined()
  })

  test("returns the stored value verbatim, unknown keys included", async function () {
    const stored = { ...userData.v3_0_0, batman: "Bruce Wayne" }
    await context.globalState.update(v3.USER_DATA_KEY, stored)
    expect(storage.getUserData()).toEqual(stored)
  })

  test("skips a course it cannot read and keeps it as stored on the next write", async function () {
    const unreadable = { id: "from-a-newer-version", kind: "something new" }
    await context.globalState.update(v3.USER_DATA_KEY, {
      ...userData.v3_0_0,
      mooc_courses: [...userData.v3_0_0.mooc_courses, unreadable],
    })

    const read = storage.getUserData()
    expect(read?.mooc_courses).toEqual(userData.v3_0_0.mooc_courses)

    await storage.updateUserData({ courses: [], mooc_courses: [] })
    expect(context.globalState.get<v3.UserData>(v3.USER_DATA_KEY)?.mooc_courses).toEqual([
      unreadable,
    ])
  })

  test("reads back what was written", async function () {
    await storage.updateUserData(userData.v3_0_0)
    await storage.updateSessionState(sessionState.v2_0_0)

    expect(storage.getUserData()).toEqual(userData.v3_0_0)
    expect(storage.getSessionState()).toEqual(sessionState.v2_0_0)
  })

  test("parses the stored courses again only once another window wrote them", async function () {
    await storage.updateUserData(userData.v3_0_0)
    const parse = vi.spyOn(v3.moocLocalCourseDataSchema, "safeParse")
    expect(storage.getUserData()).toEqual(userData.v3_0_0)
    expect(parse).not.toHaveBeenCalled()

    const unreadable = { id: "from-a-newer-version", kind: "something new" }
    await context.globalState.update(v3.USER_DATA_KEY, {
      ...userData.v3_0_0,
      mooc_courses: [unreadable],
    })
    const error = vi.spyOn(Logger, "error")
    expect(storage.getUserData()?.mooc_courses).toEqual([])
    expect(storage.getUserData()?.mooc_courses).toEqual([])
    expect(error).toHaveBeenCalledOnce()
    parse.mockRestore()
    error.mockRestore()
  })

  test("does not report a course catalogue it cannot read as an empty one", async function () {
    const corrupt = { courses: "not a list of courses" }
    await context.globalState.update(v3.USER_DATA_KEY, corrupt)

    expect(() => storage.getUserData()).toThrow(CorruptStoredDataError)
    // The blob is the only copy of the catalogue, so it stays put.
    expect(context.globalState.get(v3.USER_DATA_KEY)).toEqual(corrupt)
  })

  test("rejects a user data blob that predates mooc courses", async function () {
    await context.globalState.update(v3.USER_DATA_KEY, { courses: userData.v3_0_0.courses })
    expect(() => storage.getUserData()).toThrow(CorruptStoredDataError)
  })

  test("rejects unreadable session state", async function () {
    await context.globalState.update(v3.SESSION_STATE_KEY, { extensionVersion: 3 })

    expect(() => storage.getSessionState()).toThrow(CorruptStoredDataError)
  })

  test("names the key it could not read", async function () {
    await context.globalState.update(v3.USER_DATA_KEY, { courses: 1 })
    expect(() => storage.getUserData()).toThrow(v3.USER_DATA_KEY)
  })
})
