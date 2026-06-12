import { parseSha256Sum } from "../../init/ensureLangsUpdated";
import { expect } from "chai";

suite("ensureLangsUpdated checksum parsing", function () {
    const lowerHash = "2a31f5758b4488b279e80e57ff8248aa2485ef80d4cf27618403fb136fc07f71";
    const upperHash = lowerHash.toUpperCase();

    test("normalizes an uppercase .sha256 hash to lowercase", function () {
        // Regression: server-served uppercase hashes used to trigger a
        // redownload on every startup.
        expect(parseSha256Sum(`${upperHash}  tmc-langs-cli`)).to.equal(lowerHash);
    });

    test("leaves a lowercase hash unchanged", function () {
        expect(parseSha256Sum(`${lowerHash}  tmc-langs-cli`)).to.equal(lowerHash);
    });

    test("strips trailing whitespace/newline", function () {
        expect(parseSha256Sum(`${lowerHash}\n`)).to.equal(lowerHash);
    });
});
