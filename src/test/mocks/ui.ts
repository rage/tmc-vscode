import { IMock, Mock } from "typemoq";

import UI from "../../ui/ui";

export interface UIMockValues {}

export function createUIMock(): [IMock<UI>, UIMockValues] {
    const values: UIMockValues = {};
    const mock = setupMockValues(values);
    return [mock, values];
}

function setupMockValues(_values: UIMockValues): IMock<UI> {
    const mock = Mock.ofType<UI>();

    return mock;
}
