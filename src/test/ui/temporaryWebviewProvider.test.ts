import * as assert from "assert";
import * as TypeMoq from "typemoq";

import Resources from "../../config/resources";
import TemporaryWebviewProvider from "../../ui/temporaryWebviewProvider";
import UI from "../../ui/ui";
import Webview from "../../ui/temporaryWebview";

suite("TemporaryWebviewProvider tests", () => {
    let resourcesMock: TypeMoq.IMock<Resources>;
    let uiMock: TypeMoq.IMock<UI>;
    let provider: TemporaryWebviewProvider;

    interface MockWebviewParams {
        disposed: boolean;
        visible: boolean;
    }

    function mockWebviewGenerator(params: MockWebviewParams, count: number): Webview[] {
        const webviews: Webview[] = [];
        while (webviews.length < count) {
            let disposed = params.disposed;
            const webviewMock = TypeMoq.Mock.ofType<Webview>();
            webviewMock.setup((x) => x.disposed).returns(() => disposed);
            webviewMock.setup((x) => x.isVisible()).returns(() => params.visible);
            webviewMock.setup((x) => x.dispose()).callback(() => (disposed = true));
            webviews.push(webviewMock.object);
        }
        return webviews;
    }

    setup(() => {
        resourcesMock = TypeMoq.Mock.ofType(Resources);
        resourcesMock.setup((x) => x.cssFolder).returns(() => "");
        uiMock = TypeMoq.Mock.ofType<UI>();
        provider = new TemporaryWebviewProvider(resourcesMock.object, uiMock.object);
    });

    test("Provider creates new TemporaryWebviews", () => {
        const web1 = provider.getTemporaryWebview();
        assert.strictEqual(web1 instanceof Webview, true);
        const web2 = provider.getTemporaryWebview();
        assert.notStrictEqual(web2, web1);
    });

    test("Provider recycles old webviews", () => {
        const web1 = provider.getTemporaryWebview();
        provider.addToRecycables(web1);
        assert.strictEqual(provider.getTemporaryWebview(), web1);
    });

    test("Provider filters disposed webviews", () => {
        const web1 = provider.getTemporaryWebview();
        web1.dispose();
        provider.addToRecycables(web1);
        assert.notStrictEqual(provider.getTemporaryWebview(), web1);

        const web2 = provider.getTemporaryWebview();
        provider.addToRecycables(web2);
        web2.dispose();
        assert.notStrictEqual(provider.getTemporaryWebview(), web2);

        const web3 = provider.getTemporaryWebview();
        const web4 = provider.getTemporaryWebview();
        const web5 = provider.getTemporaryWebview();
        provider.addToRecycables(web3);
        provider.addToRecycables(web4);
        provider.addToRecycables(web5);
        web3.dispose();
        web5.dispose();
        assert.strictEqual(provider.getTemporaryWebview(), web4);
    });

    test("Provider prioritizes undisposed visible webviews", () => {
        const hiddens = mockWebviewGenerator({ disposed: false, visible: false }, 3);
        const visibles = mockWebviewGenerator({ disposed: false, visible: true }, 2);
        const [hidden1, hidden2, hidden3] = hiddens;
        const [visible1, visible2] = visibles;
        const [toBeDisposed] = mockWebviewGenerator({ disposed: false, visible: true }, 1);

        // Finds one visible webview
        provider.addToRecycables(hidden1);
        provider.addToRecycables(hidden2);
        provider.addToRecycables(visible1);
        provider.addToRecycables(hidden3);
        const provided1 = provider.getTemporaryWebview();
        assert.strictEqual(
            hiddens.find((w) => w === provided1),
            undefined,
            "Provider returned hidden webview.",
        );
        assert.strictEqual(provided1, visible1, "Expected to get the visible webview.");

        // No visibles left, returns hidden
        const provided2 = provider.getTemporaryWebview();
        assert.notStrictEqual(
            hiddens.find((w) => w === provided2),
            undefined,
            "Expected hidden webview when no visibles were available.",
        );

        // Finds multiple visibles first
        provider.addToRecycables(provided1);
        provider.addToRecycables(provided2);
        provider.addToRecycables(visible2);
        provider.addToRecycables(toBeDisposed);
        toBeDisposed.dispose();
        const provided3 = provider.getTemporaryWebview();
        const provided4 = provider.getTemporaryWebview();
        [provided3, provided4].forEach((provided) => {
            assert.notStrictEqual(
                provided,
                toBeDisposed,
                "Provider returned visible webview that was disposed.",
            );
            assert.notStrictEqual(
                visibles.find((w) => w === provided),
                undefined,
                "Expected a visible Webview.",
            );
            assert.strictEqual(
                hiddens.find((w) => w === provided),
                undefined,
                "Expected visible webview.",
            );
        });

        // Again, returns hidden
        const provided5 = provider.getTemporaryWebview();
        assert.notStrictEqual(
            hiddens.find((w) => w === provided5),
            undefined,
            "Expected hidden webview when no visibles were available.",
        );
    });
});
