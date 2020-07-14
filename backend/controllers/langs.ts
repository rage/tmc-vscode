import { Router } from "express";
import fs from "fs";
import fetch from "node-fetch";
import path from "path";

import * as config from "../../config";

const LANGS_NAME = config.productionApi.__TMC_JAR_NAME__.replace(/"/g, "");
const LANGS_URL = config.productionApi.__TMC_JAR_URL__.replace(/"/g, "");
const LANGS_RUST_URL = config.productionApi.__TMC_LANGS_RUST_DL_URL__.replace(/"/g, "");
const LANGS_RUST_VERSION = config.productionApi.__TMC_LANGS_RUST_VERSION__.replace(/"/g, "");
const LANGS_RUST_LINUX_NAME = "tmc-langs-cli-linux-" + LANGS_RUST_VERSION;
const LANGS_RUST_MACOS_NAME = "tmc-langs-cli-macos-" + LANGS_RUST_VERSION;
const LANGS_RUST_WINDOWS_NAME = "tmc-langs-cli-windows-" + LANGS_RUST_VERSION + ".exe";

const langsRouter = Router();

const download = async (url: string, fileName: string): Promise<void> => {
    const langsPath = path.resolve(__dirname, "..", "resources");
    if (!fs.existsSync(langsPath)) {
        fs.mkdirSync(langsPath, { recursive: true });
    }
    const langs = path.resolve(langsPath, fileName);
    if (!fs.existsSync(langs)) {
        console.log("Downloading", fileName, "from", url);
        const res = await fetch(url);
        if (!res.ok) {
            throw "Failed";
        }
        fs.writeFileSync(langs, await res.buffer());
        console.log(fileName, "downloaded!");
    }
};

const langs = download(LANGS_URL, LANGS_NAME);
const langsRustLinux = download(LANGS_RUST_URL + LANGS_RUST_LINUX_NAME, LANGS_RUST_LINUX_NAME);
const langsRustMacOS = download(LANGS_RUST_URL + LANGS_RUST_MACOS_NAME, LANGS_RUST_MACOS_NAME);
const langsRustWindows = download(
    LANGS_RUST_URL + LANGS_RUST_WINDOWS_NAME,
    LANGS_RUST_WINDOWS_NAME,
);

langsRouter.get("/", async (req, res) => {
    await langs;
    return res.sendFile(path.resolve(__dirname, "..", "resources", LANGS_NAME));
});

langsRouter.get("/" + LANGS_RUST_LINUX_NAME, async (req, res) => {
    await langsRustLinux;
    return res.sendFile(path.resolve(__dirname, "..", "resources", LANGS_RUST_LINUX_NAME));
});

langsRouter.get("/" + LANGS_RUST_MACOS_NAME, async (req, res) => {
    await langsRustMacOS;
    return res.sendFile(path.resolve(__dirname, "..", "resources", LANGS_RUST_MACOS_NAME));
});

langsRouter.get("/" + LANGS_RUST_WINDOWS_NAME, async (req, res) => {
    await langsRustWindows;
    return res.sendFile(path.resolve(__dirname, "..", "resources", LANGS_RUST_WINDOWS_NAME));
});

export default langsRouter;
