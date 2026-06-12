import { InitializationError } from "../../errors";
import {
    ensureLangsUpdated,
    parseSha256Sum,
    removeCliFolder,
    verifyCli,
} from "../../init/ensureLangsUpdated";
import { getLangsCLIForPlatform, getPlatform } from "../../utilities";
import { createDialogMock } from "../mocks/dialog";
import { serverUrl, startServer } from "../utils/httpServer";
import { expect } from "chai";
import * as crypto from "crypto";
import * as fs from "fs-extra";
import * as http from "http";
import * as path from "path";
import * as tmp from "tmp";

function sha256(buf: Buffer): string {
    return crypto.createHash("sha256").update(buf).digest("hex");
}

interface ServeState {
    cli: Buffer;
    // Returns the full `.sha256` file body for the n-th sha request (1-indexed).
    shaFor: (hit: number) => string;
    hits: { cli: number; sha: number };
}

function startLangsServer(state: ServeState): Promise<http.Server> {
    return startServer((req, res) => {
        if ((req.url ?? "").endsWith(".sha256")) {
            state.hits.sha++;
            const body = state.shaFor(state.hits.sha);
            res.writeHead(200, { "content-length": String(Buffer.byteLength(body)) });
            res.end(body);
        } else {
            state.hits.cli++;
            res.writeHead(200, { "content-length": String(state.cli.length) });
            res.end(state.cli);
        }
    });
}

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

    test("handles a bare uppercase hash with CRLF and no filename", function () {
        // No filename field, uppercase hex, CRLF line ending.
        expect(parseSha256Sum(`${upperHash}\r\n`)).to.equal(lowerHash);
    });

    test("tolerates leading whitespace and tab separators", function () {
        expect(parseSha256Sum(`   ${lowerHash}\ttmc-langs-cli`)).to.equal(lowerHash);
    });

    test("returns empty string for empty or whitespace-only content", function () {
        expect(parseSha256Sum("")).to.equal("");
        expect(parseSha256Sum("   \r\n  ")).to.equal("");
    });
});

suite("verifyCli", function () {
    let tmpDir: tmp.DirResult;

    setup(function () {
        tmpDir = tmp.dirSync({ unsafeCleanup: true });
    });
    teardown(function () {
        tmpDir.removeCallback();
    });

    function write(cli: Buffer, shaBody: string): { cliPath: string; shaPath: string } {
        const cliPath = path.join(tmpDir.name, "cli");
        const shaPath = cliPath + ".sha256";
        fs.writeFileSync(cliPath, cli);
        fs.writeFileSync(shaPath, shaBody);
        return { cliPath, shaPath };
    }

    test("matches when the checksum is correct", async function () {
        const cli = Buffer.from("hello cli");
        const { cliPath, shaPath } = write(cli, `${sha256(cli)}  cli`);
        const result = await verifyCli(cliPath, shaPath);
        expect(result.match).to.equal(true);
        expect(result.cliDigest).to.equal(sha256(cli));
    });

    test("matches case-insensitively against an uppercase checksum", async function () {
        const cli = Buffer.from("hello cli");
        const { cliPath, shaPath } = write(cli, `${sha256(cli).toUpperCase()}\r\n`);
        expect((await verifyCli(cliPath, shaPath)).match).to.equal(true);
    });

    test("does not match a wrong checksum but still reports both digests", async function () {
        const cli = Buffer.from("hello cli");
        const wrong = sha256(Buffer.from("other"));
        const { cliPath, shaPath } = write(cli, `${wrong}  cli`);
        const result = await verifyCli(cliPath, shaPath);
        expect(result.match).to.equal(false);
        expect(result.cliDigest).to.equal(sha256(cli));
        expect(result.hashData).to.equal(wrong);
    });

    test("does not match (and does not throw) on an empty checksum file", async function () {
        const cli = Buffer.from("hello cli");
        const { cliPath, shaPath } = write(cli, "");
        const result = await verifyCli(cliPath, shaPath);
        expect(result.match).to.equal(false);
        expect(result.hashData).to.equal("");
    });

    test("does not match (and does not throw) when the checksum file is missing", async function () {
        const cli = Buffer.from("hello cli");
        const cliPath = path.join(tmpDir.name, "cli");
        fs.writeFileSync(cliPath, cli);
        const result = await verifyCli(cliPath, cliPath + ".sha256");
        expect(result.match).to.equal(false);
        expect(result.cliDigest).to.equal(sha256(cli));
        expect(result.hashData).to.equal("");
    });

    test("does not match (and does not throw) when the CLI file is missing", async function () {
        const shaPath = path.join(tmpDir.name, "cli.sha256");
        fs.writeFileSync(shaPath, `${sha256(Buffer.from("anything"))}  cli`);
        const result = await verifyCli(path.join(tmpDir.name, "cli"), shaPath);
        expect(result.match).to.equal(false);
        expect(result.cliDigest).to.equal("");
    });

    test("does not match two unreadable files as equal", async function () {
        // Both files missing -> both digests "" -> must NOT report a match.
        const result = await verifyCli(
            path.join(tmpDir.name, "missing-cli"),
            path.join(tmpDir.name, "missing-cli.sha256"),
        );
        expect(result.match).to.equal(false);
    });
});

suite("removeCliFolder", function () {
    let tmpDir: tmp.DirResult;

    setup(function () {
        tmpDir = tmp.dirSync({ unsafeCleanup: true });
    });
    teardown(function () {
        tmpDir.removeCallback();
    });

    test("returns Ok for a non-existent folder", async function () {
        const result = await removeCliFolder(path.join(tmpDir.name, "does-not-exist"));
        expect(result.ok).to.equal(true);
    });

    test("removes a populated folder and returns Ok", async function () {
        const folder = path.join(tmpDir.name, "cli");
        fs.outputFileSync(path.join(folder, "a", "f.txt"), "data");
        const result = await removeCliFolder(folder);
        expect(result.ok).to.equal(true);
        expect(fs.existsSync(folder)).to.equal(false);
    });
});

suite("ensureLangsUpdated end-to-end", function () {
    this.timeout(20000);

    const version = "0.0.0-test";
    const executable = getLangsCLIForPlatform(getPlatform(), version);

    let server: http.Server | undefined;
    let tmpDir: tmp.DirResult;

    setup(function () {
        tmpDir = tmp.dirSync({ unsafeCleanup: true });
    });

    teardown(function (done) {
        tmpDir.removeCallback();
        if (server) {
            const s = server;
            server = undefined;
            s.close(() => done());
        } else {
            done();
        }
    });

    test("fresh install downloads, verifies, and does not double-download", async function () {
        const cli = Buffer.from("fake cli binary contents");
        const state: ServeState = {
            cli,
            shaFor: () => `${sha256(cli)}  ${executable}`,
            hits: { cli: 0, sha: 0 },
        };
        server = await startLangsServer(state);
        const [dialog] = createDialogMock();
        const folder = path.join(tmpDir.name, "cli");

        const result = await ensureLangsUpdated(folder, dialog.object, {
            downloadUrl: serverUrl(server),
            version,
        });

        expect(result.ok).to.equal(true);
        const cliPath = result.unwrap();
        expect(fs.existsSync(cliPath)).to.equal(true);
        expect(fs.readFileSync(cliPath + ".sha256", "utf-8").length).to.be.greaterThan(0);
        expect((await verifyCli(cliPath, cliPath + ".sha256")).match).to.equal(true);
        // A correct first download must not trigger a redownload.
        expect(state.hits.cli).to.equal(1);
    });

    test("fresh install accepts an uppercase + CRLF checksum on the first try", async function () {
        // An uppercase hex + CRLF checksum with no filename field must still verify
        // on the first download, with no redownload.
        const cli = Buffer.from("fake cli binary contents");
        const state: ServeState = {
            cli,
            shaFor: () => `${sha256(cli).toUpperCase()}\r\n`,
            hits: { cli: 0, sha: 0 },
        };
        server = await startLangsServer(state);
        const [dialog] = createDialogMock();
        const folder = path.join(tmpDir.name, "cli");

        const result = await ensureLangsUpdated(folder, dialog.object, {
            downloadUrl: serverUrl(server),
            version,
        });

        expect(result.ok).to.equal(true);
        expect(state.hits.cli).to.equal(1);
        expect(state.hits.sha).to.equal(1);
    });

    test("a persistently corrupt download fails closed with an Err (never throws)", async function () {
        const cli = Buffer.from("the real bytes");
        const wrong = sha256(Buffer.from("different bytes"));
        const state: ServeState = {
            cli,
            shaFor: () => `${wrong}  ${executable}`,
            hits: { cli: 0, sha: 0 },
        };
        server = await startLangsServer(state);
        const [dialog] = createDialogMock();
        const folder = path.join(tmpDir.name, "cli");

        const result = await ensureLangsUpdated(folder, dialog.object, {
            downloadUrl: serverUrl(server),
            version,
        });

        expect(result.err).to.equal(true);
        if (result.err) {
            expect(result.val).to.be.instanceOf(InitializationError);
        }
        // initial download + one redownload attempt
        expect(state.hits.cli).to.equal(2);
    });

    test("recovers when the redownload yields a matching checksum", async function () {
        const cli = Buffer.from("real bytes v2");
        const wrong = sha256(Buffer.from("nope"));
        const state: ServeState = {
            cli,
            // first checksum served is wrong, the redownload's is correct
            shaFor: (hit) =>
                hit === 1 ? `${wrong}  ${executable}` : `${sha256(cli)}  ${executable}`,
            hits: { cli: 0, sha: 0 },
        };
        server = await startLangsServer(state);
        const [dialog] = createDialogMock();
        const folder = path.join(tmpDir.name, "cli");

        const result = await ensureLangsUpdated(folder, dialog.object, {
            downloadUrl: serverUrl(server),
            version,
        });

        expect(result.ok).to.equal(true);
        const cliPath = result.unwrap();
        expect((await verifyCli(cliPath, cliPath + ".sha256")).match).to.equal(true);
        expect(state.hits.cli).to.equal(2);
    });

    test("a failed download returns an Err and never throws", async function () {
        const dead = await startLangsServer({
            cli: Buffer.alloc(0),
            shaFor: () => "",
            hits: { cli: 0, sha: 0 },
        });
        const deadUrl = serverUrl(dead);
        await new Promise<void>((resolve) => dead.close(() => resolve()));
        const [dialog] = createDialogMock();
        const folder = path.join(tmpDir.name, "cli");

        const result = await ensureLangsUpdated(folder, dialog.object, {
            downloadUrl: deadUrl,
            version,
        });

        expect(result.err).to.equal(true);
    });

    test("a valid cache with an uppercase checksum is accepted without any download", async function () {
        const cli = Buffer.from("cached cli bytes");
        const folder = path.join(tmpDir.name, "cli");
        fs.outputFileSync(path.join(folder, executable), cli);
        // Uppercase + CRLF, exactly the on-disk form 3.5.1 redownloaded on every startup.
        fs.outputFileSync(
            path.join(folder, executable + ".sha256"),
            `${sha256(cli).toUpperCase()}\r\n`,
        );
        const state: ServeState = {
            cli: Buffer.from("SHOULD NOT BE SERVED"),
            shaFor: () => "SHOULD-NOT-BE-HIT",
            hits: { cli: 0, sha: 0 },
        };
        server = await startLangsServer(state);
        const [dialog] = createDialogMock();

        const result = await ensureLangsUpdated(folder, dialog.object, {
            downloadUrl: serverUrl(server),
            version,
        });

        expect(result.ok).to.equal(true);
        expect(state.hits.cli).to.equal(0);
        expect(state.hits.sha).to.equal(0);
    });

    test("a cached CLI whose checksum file is missing recovers via redownload instead of throwing", async function () {
        // Simulates a prior run that downloaded+renamed the CLI but failed to
        // write its .sha256: the binary exists on disk, the checksum does not.
        const cli = Buffer.from("cached cli with no checksum file");
        const folder = path.join(tmpDir.name, "cli");
        fs.outputFileSync(path.join(folder, executable), cli);
        const state: ServeState = {
            cli,
            shaFor: () => `${sha256(cli)}  ${executable}`,
            hits: { cli: 0, sha: 0 },
        };
        server = await startLangsServer(state);
        const [dialog] = createDialogMock();

        const result = await ensureLangsUpdated(folder, dialog.object, {
            downloadUrl: serverUrl(server),
            version,
        });

        expect(result.ok).to.equal(true);
        const cliPath = result.unwrap();
        expect((await verifyCli(cliPath, cliPath + ".sha256")).match).to.equal(true);
        // The missing checksum forced a single redownload rather than a crash.
        expect(state.hits.cli).to.equal(1);
        expect(state.hits.sha).to.equal(1);
    });
});
