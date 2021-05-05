import { IMock, Mock } from "typemoq";

import UI from "../../ui/ui";
import TmcWebview from "../../ui/webview";

import { createWebviewMock } from "./webview";

export interface UIMockValues {
    webview: TmcWebview;
}

export function createUIMock(): [IMock<UI>, UIMockValues] {
    const values: UIMockValues = {
        webview: createWebviewMock()[0].object,
    };
    const mock = setupMockValues(values);
    return [mock, values];
}

function setupMockValues(values: UIMockValues): IMock<UI> {
    const mock = Mock.ofType<UI>();

    mock.setup((x) => x.webview).returns(() => values.webview);

    return mock;
}
