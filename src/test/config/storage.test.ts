import * as assert from "assert";
import * as TypeMoq from "typemoq";
import * as vscode from "vscode";

import Storage from "../../config/storage";

suite("Storage tests", () => {

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
        mockMemento
            .verify((x) => x.update(TypeMoq.It.isAnyString(), TypeMoq.It.isValue("test")), TypeMoq.Times.once());

        // getting
        mockMemento.verify((x) => x.get(TypeMoq.It.isAnyString()), TypeMoq.Times.never());
        storage.getOrganizationSlug();
        mockMemento.verify((x) => x.get(TypeMoq.It.isAnyString()), TypeMoq.Times.once());
    });

    test("Course id is stored correctly", () => {
        const { mockContext, mockMemento } = createMocks();
        const storage = new Storage(mockContext.object);

        // updating
        mockMemento
            .verify((x) => x.update(TypeMoq.It.isAnyString(), TypeMoq.It.isValue("1337")), TypeMoq.Times.never());
        storage.updateCourseId("1337");
        mockMemento
            .verify((x) => x.update(TypeMoq.It.isAnyString(), TypeMoq.It.isValue("1337")), TypeMoq.Times.once());

        // getting
        mockMemento.verify((x) => x.get(TypeMoq.It.isAnyString()), TypeMoq.Times.never());
        storage.getCourseId();
        mockMemento.verify((x) => x.get(TypeMoq.It.isAnyString()), TypeMoq.Times.once());
    });

});
