import * as http from "http";

export type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

/**
 * Starts an HTTP server on an ephemeral loopback port and resolves once it is
 * listening. Shared by the download/CLI tests.
 */
export function startServer(handler: Handler): Promise<http.Server> {
    const server = http.createServer(handler);
    return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

/** Builds the loopback URL (optionally with a path) for a listening server. */
export function serverUrl(server: http.Server, p = "/"): string {
    const addr = server.address();
    if (addr && typeof addr === "object") {
        return `http://127.0.0.1:${addr.port}${p}`;
    }
    throw new Error("test server has no address");
}
