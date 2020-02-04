import * as assert from "assert";

import { Visibility } from "../../ui/treeview/visibility";

suite("Treeview Visibility tests", () => {

    function before() {
        const visibility = new Visibility();

        const g0 = visibility.createGroup(false);
        const g1 = visibility.createGroup(false);
        const g2 = visibility.createGroup(false);

        return {visibility, g0, g1, g2};
    }

    test("Registered action ids must be unique", () => {
        const {visibility, g0, g1, g2} = before();
        assert.doesNotThrow(() => visibility.registerAction("a0", [g0]));
        assert.throws(() => visibility.registerAction("a0", [g0]));
        assert.throws(() => visibility.registerAction("a0", [g1]));
    });

    test("Action with no dependencies always visible", () => {
        const {visibility, g0, g1, g2} = before();
        assert.doesNotThrow(() => visibility.registerAction("a0", []));
        assert.equal(visibility.getVisible("a0"), true);
    });

    test("Single group dependency works correctly", () => {
        const {visibility, g0, g1, g2} = before();
        assert.doesNotThrow(() => visibility.registerAction("a0", [g0]));
        assert.equal(visibility.getVisible("a0"), false);
        let changes: Array<[string, boolean]> = [];
        assert.doesNotThrow(() => {changes = visibility.setGroupVisible(g0); });
        assert.deepEqual(changes, [["a0", true]]);
        assert.equal(visibility.getVisible("a0"), true);
    });

    test("Negated group dependency works correctly", () => {
        const {visibility, g0, g1, g2} = before();
        assert.doesNotThrow(() => visibility.registerAction("a0", [g0.not]));
        assert.equal(visibility.getVisible("a0"), true);
        let changes: Array<[string, boolean]> = [];
        assert.doesNotThrow(() => {changes = visibility.setGroupVisible(g0); });
        assert.deepEqual(changes, [["a0", false]]);
        assert.equal(visibility.getVisible("a0"), false);
    });

    test("Multiple actions with multiple dependencies work correctly", () => {
        const {visibility, g0, g1, g2} = before();
        let changes: Array<[string, boolean]> = [];

        assert.doesNotThrow(() => visibility.registerAction("a0", [g0.not, g1, g2]));
        assert.doesNotThrow(() => visibility.registerAction("a1", [g0.not, g1.not, g2]));
        assert.doesNotThrow(() => visibility.registerAction("a2", [g0, g1, g2]));
        assert.doesNotThrow(() => visibility.registerAction("a3", [g0.not, g1.not, g2.not]));

        assert.equal(visibility.getVisible("a0"), false);
        assert.equal(visibility.getVisible("a1"), false);
        assert.equal(visibility.getVisible("a2"), false);
        assert.equal(visibility.getVisible("a3"), true);

        assert.doesNotThrow(() => {changes = visibility.setGroupVisible(g2); });
        assert.deepEqual(changes, [["a1", true], ["a3", false]]);
        assert.equal(visibility.getVisible("a0"), false);
        assert.equal(visibility.getVisible("a1"), true);
        assert.equal(visibility.getVisible("a2"), false);
        assert.equal(visibility.getVisible("a3"), false);

        assert.doesNotThrow(() => {changes = visibility.setGroupVisible(g1); });
        assert.deepEqual(changes, [["a0", true], ["a1", false]]);
        assert.equal(visibility.getVisible("a0"), true);
        assert.equal(visibility.getVisible("a1"), false);
        assert.equal(visibility.getVisible("a2"), false);
        assert.equal(visibility.getVisible("a3"), false);

        assert.doesNotThrow(() => {changes = visibility.setGroupVisible(g0); });
        assert.deepEqual(changes, [["a2", true], ["a0", false]]);
        assert.equal(visibility.getVisible("a0"), false);
        assert.equal(visibility.getVisible("a1"), false);
        assert.equal(visibility.getVisible("a2"), true);
        assert.equal(visibility.getVisible("a3"), false);

    });

});
