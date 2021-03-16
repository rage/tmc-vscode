import { Ok, Result } from "ts-results";
import { IMock, It, Mock } from "typemoq";

import WorkspaceManager, { WorkspaceExercise } from "../../api/workspaceManager";
import { workspaceExercises } from "../fixtures/workspaceManager";

export interface WorkspaceManagerMockValues {
    activeCourse?: string;
    activeExercise?: Readonly<WorkspaceExercise>;
    closeExercises: Result<void, Error>;
    getExercisesByCoursePythonCourse: ReadonlyArray<WorkspaceExercise>;
    setExercises: Result<void, Error>;
    uriIsExercise: boolean;
}

export function createWorkspaceMangerMock(): [IMock<WorkspaceManager>, WorkspaceManagerMockValues] {
    const values: WorkspaceManagerMockValues = {
        activeCourse: undefined,
        activeExercise: undefined,
        closeExercises: Ok.EMPTY,
        getExercisesByCoursePythonCourse: workspaceExercises,
        setExercises: Ok.EMPTY,
        uriIsExercise: true,
    };
    const mock = setupMockValues(values);

    return [mock, values];
}

function setupMockValues(values: WorkspaceManagerMockValues): IMock<WorkspaceManager> {
    const mock = Mock.ofType<WorkspaceManager>();

    mock.setup((x) => x.activeCourse).returns(() => values.activeCourse);
    mock.setup((x) => x.activeExercise).returns(() => values.activeExercise);

    mock.setup((x) => x.closeCourseExercises(It.isAny(), It.isAny())).returns(
        async () => values.closeExercises,
    );

    mock.setup((x) => x.getExercisesByCourseSlug(It.isValue("test-python-course"))).returns(
        () => values.getExercisesByCoursePythonCourse,
    );

    mock.setup((x) => x.setExercises(It.isAny())).returns(async () => values.setExercises);
    mock.setup((x) => x.uriIsExercise(It.isAny())).returns(() => values.uriIsExercise);

    return mock;
}
