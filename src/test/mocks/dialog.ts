import { IMock, It, Mock } from "typemoq";

import Dialog from "../../api/dialog";

export interface DialogMockValues {
    confirmation: boolean | undefined;
}

export function createDialogMock(): [IMock<Dialog>, DialogMockValues] {
    const mock = Mock.ofType<Dialog>();
    const values: DialogMockValues = {
        confirmation: true,
    };

    mock.setup((x) => x.confirmation(It.isAny())).returns(async () => values.confirmation);

    // Call the attached callback.
    mock.setup((x) => x.progressNotification(It.isAny(), It.isAny())).returns((_, cb) =>
        cb({ report: () => {} }),
    );

    return [mock, values];
}
