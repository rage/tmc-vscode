import { expect } from "chai";
import { Err, Ok } from "ts-results";
import { IMock, It, Times } from "typemoq";

import { checkForExerciseUpdates } from "../../actions";
import { ActionContext } from "../../actions/types";
import TMC from "../../api/tmc";
import { UserData } from "../../config/userdata";
import { createMockActionContext } from "../mocks/actionContext";
import { createTMCMock, TMCMockValues } from "../mocks/tmc";
import { createUserDataMock } from "../mocks/userdata";

suite("checkForExerciseUpdates action", function () {
    const stubContext = createMockActionContext();
    const updateableExercises = [{ courseId: 0, exerciseId: 2, exerciseName: "other_world" }];

    let tmcMock: IMock<TMC>;
    let tmcMockValues: TMCMockValues;
    let userDataMock: IMock<UserData>;

    const actionContext = (): ActionContext => ({
        ...stubContext,
        tmc: new Ok(tmcMock.object),
        userData: new Ok(userDataMock.object),
    });

    setup(function () {
        [tmcMock, tmcMockValues] = createTMCMock();
        [userDataMock] = createUserDataMock();
    });

    test("should return exercise updates", async function () {
        const result = await checkForExerciseUpdates(actionContext());
        expect(result.val).to.be.deep.equal(updateableExercises);
    });

    test("should respect forceRefresh option", async function () {
        for (const forceRefresh of [true, false]) {
            await checkForExerciseUpdates(actionContext(), { forceRefresh });
            tmcMock.verify(
                (x) => x.checkExerciseUpdates(It.isObjectWith({ forceRefresh })),
                Times.once(),
            );
        }
    });

    test("should return empty array when there are no updates", async function () {
        tmcMockValues.checkExerciseUpdates = Ok([]);
        const result = await checkForExerciseUpdates(actionContext());
        expect(result.val).to.be.deep.equal([]);
    });

    test("should filter out unknown exercise ids", async function () {
        tmcMockValues.checkExerciseUpdates = Ok([
            ...tmcMockValues.checkExerciseUpdates,
            { id: 404 },
        ]);
        const result = await checkForExerciseUpdates(actionContext());
        expect(result.val).to.be.deep.equal(updateableExercises);
    });

    test("should result in error if Langs operation fails", async function () {
        tmcMockValues.checkExerciseUpdates = Err(new Error());
        const result = await checkForExerciseUpdates(actionContext());
        expect(result.val).to.be.instanceOf(Error);
    });
});
