import { ConnectionError } from "../../errors";
import { downloadFile } from "../../utilities/utils";
import { expect } from "chai";
import * as fs from "fs-extra";
import * as http from "http";
import * as path from "path";
import * as tmp from "tmp";

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

function startServer(handler: Handler): Promise<http.Server> {
    const server = http.createServer(handler);
    return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

function urlFor(server: http.Server, p = "/"): string {
    const addr = server.address();
    if (addr && typeof addr === "object") {
        return `http://127.0.0.1:${addr.port}${p}`;
    }
    throw new Error("test server has no address");
}

suite("downloadFile", function () {
    this.timeout(20000);

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

    test("writes the full body to disk before resolving, even when the event loop is then starved", async function () {
        // A tiny body arrives in one chunk; the file must be fully written by the
        // time downloadFile resolves, even if the caller then blocks the event loop.
        const body = "2a31f5758b4488b279e80e57ff8248aa2485ef80d4cf27618403fb136fc07f71\r\n";
        server = await startServer((_req, res) => {
            res.writeHead(200, {
                "content-type": "application/octet-stream",
                "content-length": String(Buffer.byteLength(body)),
            });
            res.end(body);
        });
        const out = path.join(tmpDir.name, "x.sha256");

        const result = await downloadFile(urlFor(server), out);
        // Block the event loop the way the synchronous CLI hashing does.
        const start = Date.now();
        while (Date.now() - start < 200) {
            /* busy-wait */
        }
        const onDisk = fs.readFileSync(out, "utf-8");

        expect(result.ok).to.equal(true);
        expect(onDisk).to.equal(body);
    });

    test("writes a large multi-chunk body byte-for-byte (backpressure)", async function () {
        const body = Buffer.alloc(8 * 1024 * 1024);
        for (let i = 0; i < body.length; i++) {
            body[i] = i % 256;
        }
        server = await startServer((_req, res) => {
            res.writeHead(200, { "content-length": String(body.length) });
            res.end(body);
        });
        const out = path.join(tmpDir.name, "big.bin");

        const result = await downloadFile(urlFor(server), out);

        expect(result.ok).to.equal(true);
        const onDisk = fs.readFileSync(out);
        expect(onDisk.length).to.equal(body.length);
        expect(onDisk.equals(body)).to.equal(true);
    });

    test("reports monotonic progress up to 100", async function () {
        const body = Buffer.alloc(2 * 1024 * 1024, 7);
        server = await startServer((_req, res) => {
            res.writeHead(200, { "content-length": String(body.length) });
            res.end(body);
        });
        const out = path.join(tmpDir.name, "prog.bin");
        const percents: number[] = [];

        const result = await downloadFile(urlFor(server), out, undefined, (percent) => {
            percents.push(percent);
        });

        expect(result.ok).to.equal(true);
        expect(percents.length).to.be.greaterThan(0);
        for (let i = 1; i < percents.length; i++) {
            expect(percents[i]).to.be.at.least(percents[i - 1]);
        }
        expect(percents[percents.length - 1]).to.equal(100);
    });

    test("releases the file handle so the directory can be removed immediately", async function () {
        const body = "small";
        server = await startServer((_req, res) => {
            res.writeHead(200, { "content-length": String(body.length) });
            res.end(body);
        });
        const out = path.join(tmpDir.name, "sub", "f.txt");

        await downloadFile(urlFor(server), out);
        // No open fd should remain; on Windows a leftover handle throws ENOTEMPTY.
        expect(() => fs.rmSync(path.join(tmpDir.name, "sub"), { recursive: true })).to.not.throw();
    });

    test("returns Err with 'Request failed' on a non-2xx response", async function () {
        server = await startServer((_req, res) => {
            res.writeHead(404);
            res.end("nope");
        });
        const out = path.join(tmpDir.name, "missing");

        const result = await downloadFile(urlFor(server), out);

        expect(result.err).to.equal(true);
        if (result.err) {
            expect(result.val.message).to.contain("Request failed");
        }
    });

    test("returns a ConnectionError when the host is unreachable", async function () {
        const dead = await startServer(() => {});
        const deadUrl = urlFor(dead);
        await new Promise<void>((resolve) => dead.close(() => resolve()));
        const out = path.join(tmpDir.name, "unreachable");

        const result = await downloadFile(deadUrl, out);

        expect(result.err).to.equal(true);
        if (result.err) {
            expect(result.val).to.be.instanceOf(ConnectionError);
        }
    });
});
