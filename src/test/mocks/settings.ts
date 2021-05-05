import { IMock, Mock } from "typemoq";

import Settings from "../../config/settings";

export interface SettingsMockValues {
    getDownloadOldSubmission: boolean;
}

export function createSettingsMock(): [IMock<Settings>, SettingsMockValues] {
    const values: SettingsMockValues = {
        getDownloadOldSubmission: false,
    };
    const mock = setupMockValues(values);
    return [mock, values];
}

function setupMockValues(values: SettingsMockValues): IMock<Settings> {
    const mock = Mock.ofType<Settings>();

    mock.setup((x) => x.getDownloadOldSubmission()).returns(() => values.getDownloadOldSubmission);

    return mock;
}
