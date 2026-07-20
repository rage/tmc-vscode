import { expect } from "chai"
import { Err, Ok } from "ts-results"
import type { IMock } from "typemoq"
import { It, Times } from "typemoq"

import { checkForExerciseUpdates } from "../../actions"
import type { ActionContext } from "../../actions/types"
import type Langs from "../../api/langs"
import type { UserData } from "../../config/userdata"
import { createMockActionContext } from "../mocks/actionContext"
import type { TMCMockValues } from "../mocks/tmc"
import { createTMCMock } from "../mocks/tmc"
import { createUserDataMock } from "../mocks/userdata"

suite("checkForExerciseUpdates action", function () {
  const stubContext = createMockActionContext()
  const updateableExercises = [{ courseId: 0, exerciseId: 2, exerciseName: "other_world" }]

  let tmcMock: IMock<Langs>
  let tmcMockValues: TMCMockValues
  let userDataMock: IMock<UserData>

  const actionContext = (): ActionContext => ({
    ...stubContext,
    langs: new Ok(tmcMock.object),
    userData: new Ok(userDataMock.object),
  })

  setup(function () {
    ;[tmcMock, tmcMockValues] = createTMCMock()
    ;[userDataMock] = createUserDataMock()
  })

  test("should return exercise updates", async function () {
    const result = await checkForExerciseUpdates(actionContext())
    expect(result.val).to.be.deep.equal(updateableExercises)
  })

  test("should respect forceRefresh option", async function () {
    for (const forceRefresh of [true, false]) {
      await checkForExerciseUpdates(actionContext(), { forceRefresh })
      tmcMock.verify(
        (x) => x.checkTmcExerciseUpdates(It.isObjectWith({ forceRefresh })),
        Times.once(),
      )
    }
  })

  test("should return empty array when there are no updates", async function () {
    tmcMockValues.checkExerciseUpdates = Ok([])
    const result = await checkForExerciseUpdates(actionContext())
    expect(result.val).to.be.deep.equal([])
  })

  test("should filter out unknown exercise ids", async function () {
    tmcMockValues.checkExerciseUpdates = Ok([...tmcMockValues.checkExerciseUpdates, { id: 404 }])
    const result = await checkForExerciseUpdates(actionContext())
    expect(result.val).to.be.deep.equal(updateableExercises)
  })

  test("should result in error if Langs operation fails", async function () {
    tmcMockValues.checkExerciseUpdates = Err(new Error())
    const result = await checkForExerciseUpdates(actionContext())
    expect(result.val).to.be.instanceOf(Error)
  })
})
