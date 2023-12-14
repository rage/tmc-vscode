import { expect } from "chai";

import { semVerCompare } from "../../utilities";

suite("Semantic version utils", function () {
    test("Major version comparisons work as expected", function () {
        expect(semVerCompare("1.2.3", "1.2.3", "major")).to.be.equal(0, "1.2.3 === 1.2.3");
        expect(semVerCompare("1.2.0", "1.2.3", "major")).to.be.equal(0, "1.2.0 === 1.2.3");
        expect(semVerCompare("1.0.0", "1.2.3", "major")).to.be.equal(0, "1.0.0 === 1.2.3");
        expect(semVerCompare("1.1.1", "2.0.0", "major")).to.be.below(0, "1.1.1 < 2.0.0");
        expect(semVerCompare("2.0.0", "1.1.1", "major")).to.be.above(0, "2.0.0 > 1.1.1");
    });

    test("Minor version comparisons work as expected", function () {
        expect(semVerCompare("1.2.3", "1.2.3", "minor")).to.be.equal(0, "1.2.3 === 1.2.3");
        expect(semVerCompare("1.2.0", "1.2.3", "minor")).to.be.equal(0, "1.2.0 === 1.2.3");
        expect(semVerCompare("1.0.0", "1.2.3", "minor")).to.be.below(0, "1.0.0 < 1.2.3");
        expect(semVerCompare("1.1.1", "2.0.0", "minor")).to.be.below(0, "1.1.1 < 2.0.0");
        expect(semVerCompare("2.0.0", "1.1.1", "minor")).to.be.above(0, "2.0.0 > 1.1.1");
    });

    test("Patch version comparisons work as expected", function () {
        expect(semVerCompare("1.2.3", "1.2.3", "patch")).to.be.equal(0, "1.2.3 === 1.2.3");
        expect(semVerCompare("1.2.0", "1.2.3", "patch")).to.be.below(0, "1.2.0 < 1.2.3");
        expect(semVerCompare("1.0.0", "1.2.3", "patch")).to.be.below(0, "1.0.0 < 1.2.3");
        expect(semVerCompare("1.1.1", "2.0.0", "patch")).to.be.below(0, "1.1.1 < 2.0.0");
        expect(semVerCompare("2.0.0", "1.1.1", "patch")).to.be.above(0, "2.0.0 > 1.1.1");
    });

    test("Non semantic version comparisations return undefined", function () {
        expect(semVerCompare("", "1.0.0", "patch")).to.be.equal(undefined);
        expect(semVerCompare("1", "1.0.0", "patch")).to.be.equal(undefined);
        expect(semVerCompare("100", "1.0.0", "patch")).to.be.equal(undefined);
        expect(semVerCompare("1.0", "1.0.0", "patch")).to.be.equal(undefined);
    });
});
