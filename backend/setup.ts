import archiver from "archiver";
import fs from "fs";
import { ncp } from "ncp";
import fetch from "node-fetch";
import path from "path";

import * as config from "../config";

const LANGS_RUST_URL = config.productionApi.__TMC_LANGS_RUST_DL_URL__.replace(/"/g, "");
const LANGS_RUST_VERSION = config.productionApi.__TMC_LANGS_RUST_VERSION__.replace(/"/g, "");

// TODO: Make ../scr/utils/env.ts usable without webpack so that we get rid of duplicate code.
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
        if (arch === "arm64") {
            return "tmc-langs-cli-aarch64-apple-darwin-" + LANGS_RUST_VERSION;
        } else if (arch === "x64") {
            return "tmc-langs-cli-x86_64-apple-darwin-" + LANGS_RUST_VERSION;
        } else {
            return "tmc-langs-cli-x86_64-unknown-linux-gnu-" + LANGS_RUST_VERSION;
        }
    }
    return "other";
})();

const copyTMCPythonModules = async (): Promise<void> => {
    const module = path.join(__dirname, "..", "submodules", "tmc-python-tester", "tmc");
    const courseDirectory = path.join(path.join(__dirname, "resources", "test-python-course"));
    const pythonExercises = fs
        .readdirSync(courseDirectory, { withFileTypes: true })
        .filter((x) => x.isDirectory())
        .map((x) => path.join(courseDirectory, x.name));
    pythonExercises.forEach((exercise) => {
        const target = path.join(exercise, "tmc");
        console.log(`Copying tmc module to ${target}`);
        ncp(module, target, () => {});
    });
    console.log("Modules copied!");

    await Promise.all(
        pythonExercises.map(async (exercise) => {
            console.log(`Creating download archive for ${exercise}`);
            const archive = archiver("zip");
            const archivePath = fs.createWriteStream(exercise + ".zip");
            archive.pipe(archivePath);
            archive.directory(exercise, false);
            await archive.finalize();
        }),
    );
    console.log("Archives created!");
};

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
        console.log("Copying tmc modules to python courses...");
        await copyTMCPythonModules();
        console.log("Starting server setup...");
        await download(LANGS_RUST_URL + langsVersion, langsVersion);
        console.log("Setup complete!");
    } catch (err) {
        console.error("Failed to download langs files.");
        process.exit(1);
    }
})();
