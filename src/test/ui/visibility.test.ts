import { Visibility } from "../../ui/treeview/visibility";
import { VisibilityGroup } from "../../ui/types";
import * as assert from "assert";

suite("Treeview Visibility tests", () => {
    function before(): {
        visibility: Visibility;
        g0: VisibilityGroup;
        g1: VisibilityGroup;
        g2: VisibilityGroup;
    } {
        const visibility = new Visibility();

        const g0 = visibility.createGroup(false);
        const g1 = visibility.createGroup(false);
        const g2 = visibility.createGroup(false);

        return { visibility, g0, g1, g2 };
    }

    test("Registered action ids must be unique", () => {
        const { visibility, g0, g1 } = before();
        assert.doesNotThrow(() => visibility.registerAction("a0", [g0]));
        assert.throws(() => visibility.registerAction("a0", [g0]));
        assert.throws(() => visibility.registerAction("a0", [g1]));
    });

    test("Action with no dependencies always visible", () => {
        const { visibility } = before();
        assert.doesNotThrow(() => visibility.registerAction("a0", []));
        assert.strictEqual(visibility.getVisible("a0"), true);
    });

    test("Single group dependency works correctly", () => {
        const { visibility, g0 } = before();
        assert.doesNotThrow(() => visibility.registerAction("a0", [g0]));
        assert.strictEqual(visibility.getVisible("a0"), false);
        let changes: Array<[string, boolean]> = [];
        assert.doesNotThrow(() => {
            changes = visibility.setGroupVisible(g0);
        });
        assert.deepStrictEqual(changes, [["a0", true]]);
        assert.strictEqual(visibility.getVisible("a0"), true);
    });

    test("Negated group dependency works correctly", () => {
        const { visibility, g0 } = before();
        assert.doesNotThrow(() => visibility.registerAction("a0", [g0.not]));
        assert.strictEqual(visibility.getVisible("a0"), true);
        let changes: Array<[string, boolean]> = [];
        assert.doesNotThrow(() => {
            changes = visibility.setGroupVisible(g0);
        });
        assert.deepStrictEqual(changes, [["a0", false]]);
        assert.strictEqual(visibility.getVisible("a0"), false);
    });

    test("Multiple actions with multiple dependencies work correctly", () => {
        const { visibility, g0, g1, g2 } = before();
        let changes: Array<[string, boolean]> = [];

        assert.doesNotThrow(() => visibility.registerAction("a0", [g0.not, g1, g2]));
        assert.doesNotThrow(() => visibility.registerAction("a1", [g0.not, g1.not, g2]));
        assert.doesNotThrow(() => visibility.registerAction("a2", [g0, g1, g2]));
        assert.doesNotThrow(() => visibility.registerAction("a3", [g0.not, g1.not, g2.not]));

        assert.strictEqual(visibility.getVisible("a0"), false);
        assert.strictEqual(visibility.getVisible("a1"), false);
        assert.strictEqual(visibility.getVisible("a2"), false);
        assert.strictEqual(visibility.getVisible("a3"), true);

        assert.doesNotThrow(() => {
            changes = visibility.setGroupVisible(g2);
        });
        assert.deepStrictEqual(changes, [
            ["a1", true],
            ["a3", false],
        ]);
        assert.strictEqual(visibility.getVisible("a0"), false);
        assert.strictEqual(visibility.getVisible("a1"), true);
        assert.strictEqual(visibility.getVisible("a2"), false);
        assert.strictEqual(visibility.getVisible("a3"), false);

        assert.doesNotThrow(() => {
            changes = visibility.setGroupVisible(g1);
        });
        assert.deepStrictEqual(changes, [
            ["a0", true],
            ["a1", false],
        ]);
        assert.strictEqual(visibility.getVisible("a0"), true);
        assert.strictEqual(visibility.getVisible("a1"), false);
        assert.strictEqual(visibility.getVisible("a2"), false);
        assert.strictEqual(visibility.getVisible("a3"), false);

        assert.doesNotThrow(() => {
            changes = visibility.setGroupVisible(g0);
        });
        assert.deepStrictEqual(changes, [
            ["a2", true],
            ["a0", false],
        ]);
        assert.strictEqual(visibility.getVisible("a0"), false);
        assert.strictEqual(visibility.getVisible("a1"), false);
        assert.strictEqual(visibility.getVisible("a2"), true);
        assert.strictEqual(visibility.getVisible("a3"), false);
    });
});
