import fs from "fs";
import fetch from "node-fetch";
import path from "path";

import * as config from "../config";

const LANGS_NAME = config.productionApi.__TMC_JAR_NAME__.replace(/"/g, "");
const LANGS_URL = config.productionApi.__TMC_JAR_URL__.replace(/"/g, "");
const LANGS_RUST_URL = config.productionApi.__TMC_LANGS_RUST_DL_URL__.replace(/"/g, "");
const LANGS_RUST_VERSION = config.productionApi.__TMC_LANGS_RUST_VERSION__.replace(/"/g, "");

const versions = [
    "tmc-langs-cli-i686-unknown-linux-gnu-" + LANGS_RUST_VERSION,
    "tmc-langs-cli-x86_64-unknown-linux-gnu-" + LANGS_RUST_VERSION,
    "tmc-langs-cli-x86_64-apple-darwin-" + LANGS_RUST_VERSION,
    "tmc-langs-cli-i686-pc-windows-msvc-" + LANGS_RUST_VERSION + ".exe",
    "tmc-langs-cli-x86_64-pc-windows-msvc-" + LANGS_RUST_VERSION + ".exe",
    "tmc-langs-cli-armv7-unknown-linux-gnueabihf-" + LANGS_RUST_VERSION,
    "tmc-langs-cli-aarch64-unknown-linux-gnu-" + LANGS_RUST_VERSION,
];

const download = async (url: string, fileName: string): Promise<void> => {
    const langsPath = path.resolve(__dirname, "resources");
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
        await download(LANGS_URL, LANGS_NAME);
        for (const version of versions) {
            await download(LANGS_RUST_URL + version, version);
        }
        console.log("Setup complete!");
    } catch (err) {
        console.error("Failed to download langs files.");
        process.exit(1);
    }
})();
