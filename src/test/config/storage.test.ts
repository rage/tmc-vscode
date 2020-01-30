import * as assert from "assert";
import * as oauth2 from "client-oauth2";
import * as TypeMoq from "typemoq";
import * as vscode from "vscode";

import Storage from "../../config/storage";

suite("Storage tests", () => {

    // Same as hardcoded in storage. We also "magically" know them here to protect against data loss between releases
    const AUTHENTICATION_TOKEN_KEY = "token";
    const COURSE_KEY = "course";
    const ORGANIZATION_KEY = "organization";

    function createMocks() {
        const mockMemento = TypeMoq.Mock.ofType<vscode.Memento>();
        const mockContext = TypeMoq.Mock.ofType<vscode.ExtensionContext>();
        mockContext.setup((x) => x.globalState).returns(() => mockMemento.object);
        return { mockContext, mockMemento };
    }

    test("Organization slug is stored correctly", () => {
        const { mockContext, mockMemento } = createMocks();
        const storage = new Storage(mockContext.object);

        // updating
        mockMemento
            .verify((x) => x.update(TypeMoq.It.isAnyString(), TypeMoq.It.isValue("test")), TypeMoq.Times.never());
        storage.updateOrganizationSlug("test");
        mockMemento.verify((x) =>
            x.update(TypeMoq.It.isValue(ORGANIZATION_KEY), TypeMoq.It.isValue("test")), TypeMoq.Times.once());

        // getting
        mockMemento.verify((x) => x.get(TypeMoq.It.isAnyString()), TypeMoq.Times.never());
        storage.getOrganizationSlug();
        mockMemento.verify((x) => x.get(TypeMoq.It.isValue(ORGANIZATION_KEY)), TypeMoq.Times.once());
    });

    test("Course id is stored correctly", () => {
        const { mockContext, mockMemento } = createMocks();
        const storage = new Storage(mockContext.object);

        // updating
        mockMemento
            .verify((x) => x.update(TypeMoq.It.isAnyString(), TypeMoq.It.isValue(1337)), TypeMoq.Times.never());
        storage.updateCourseId(1337);
        mockMemento
            .verify((x) => x.update(TypeMoq.It.isValue(COURSE_KEY), TypeMoq.It.isValue(1337)), TypeMoq.Times.once());

        // getting
        mockMemento.verify((x) => x.get(TypeMoq.It.isAnyString()), TypeMoq.Times.never());
        storage.getCourseId();
        mockMemento.verify((x) => x.get(TypeMoq.It.isValue(COURSE_KEY)), TypeMoq.Times.once());
    });

    test("Authentication token data is stored correctly", () => {
        const { mockContext, mockMemento } = createMocks();
        const storage = new Storage(mockContext.object);

        const tokenData: oauth2.Data = {type: "bearer", scope: "public"};

        // updating
        mockMemento.verify((x) => x.update(TypeMoq.It.isAnyString(),
                                           TypeMoq.It.isValue(tokenData)), TypeMoq.Times.never());
        storage.updateAuthenticationToken(tokenData);
        mockMemento.verify((x) => x.update(TypeMoq.It.isValue(AUTHENTICATION_TOKEN_KEY),
                                           TypeMoq.It.isValue(tokenData)), TypeMoq.Times.once());

        // getting
        mockMemento.verify((x) => x.get(TypeMoq.It.isAnyString()), TypeMoq.Times.never());
        storage.getAuthenticationToken();
        mockMemento.verify((x) => x.get(TypeMoq.It.isValue(AUTHENTICATION_TOKEN_KEY)), TypeMoq.Times.once());
    });

});
