import fs from "fs";
import fetch from "node-fetch";
import path from "path";

import * as config from "../config";

const LANGS_RUST_URL = config.productionApi.__TMC_LANGS_RUST_DL_URL__.replace(/"/g, "");
const LANGS_RUST_VERSION = config.productionApi.__TMC_LANGS_RUST_VERSION__.replace(/"/g, "");

const langsVersion = ((): string => {
    const platform = process.platform;
    const arch = process.arch;
    if (platform === "linux") {
        if (arch === "x64") {
            return "tmc-langs-cli-x86_64-unknown-linux-gnu-" + LANGS_RUST_VERSION;
        } else if (arch === "arm64") {
            return "tmc-langs-cli-aarch64-unknown-linux-gnu-" + LANGS_RUST_VERSION;
        } else if (arch === "arm") {
            return "tmc-langs-cli-armv7-unknown-linux-gnueabihf-" + LANGS_RUST_VERSION;
        } else {
            return "tmc-langs-cli-i686-unknown-linux-gnu-" + LANGS_RUST_VERSION;
        }
    } else if (platform === "win32") {
        return arch === "x64"
            ? `tmc-langs-cli-x86_64-pc-windows-msvc-${LANGS_RUST_VERSION}.exe`
            : `tmc-langs-cli-i686-pc-windows-msvc-${LANGS_RUST_VERSION}.exe`;
    } else if (platform === "darwin") {
        return arch === "x64"
            ? "tmc-langs-cli-x86_64-apple-darwin-" + LANGS_RUST_VERSION
            : "tmc-langs-cli-x86_64-unknown-linux-gnu-" + LANGS_RUST_VERSION;
    }
    return "other";
})();

const download = async (url: string, fileName: string): Promise<void> => {
    const langsPath = path.resolve(__dirname, "cli");
    if (!fs.existsSync(langsPath)) {
        fs.mkdirSync(langsPath, { recursive: true });
    }
    const langs = path.resolve(langsPath, fileName);
    if (fs.existsSync(langs)) {
        console.log("Skipping", fileName, "- already exists");
        return;
    }

    console.log("Downloading", fileName, "from", url);
    const res = await fetch(url);
    if (!res.ok) {
        throw "Failed to download from " + url;
    }
    fs.writeFileSync(langs, await res.buffer());
    console.log(fileName, "downloaded!");
};

(async (): Promise<void> => {
    try {
        console.log("Starting server setup...");
        await download(LANGS_RUST_URL + langsVersion, langsVersion);
        console.log("Setup complete!");
    } catch (err) {
        console.error("Failed to download langs files.");
        process.exit(1);
    }
})();
