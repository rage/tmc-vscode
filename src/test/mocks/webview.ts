import { IMock, Mock } from "typemoq";

import { WebviewMessage } from "../../ui/types";
import TmcWebview from "../../ui/webview";

export interface WebviewMockValues {
    postMessage: (...messages: WebviewMessage[]) => void;
}

export function createWebviewMock(): [IMock<TmcWebview>, WebviewMockValues] {
    const values: WebviewMockValues = {
        postMessage: () => {},
    };
    const mock = setupMockValues(values);
    return [mock, values];
}

function setupMockValues(values: WebviewMockValues): IMock<TmcWebview> {
    const mock = Mock.ofType<TmcWebview>();

    mock.setup((x) => x.postMessage).returns(() => values.postMessage);

    return mock;
}
