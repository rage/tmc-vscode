import * as config from "../config";
import { getLangsCLIForPlatform, getPlatform } from "../src/utilities/env";
import archiver from "archiver";
import fs from "fs";
import { ncp } from "ncp";
import path from "path";

const TMC_LANGS_DL_URL = config.productionApi.__TMC_LANGS_DL_URL__.replace(/"/g, "");
const TMC_LANGS_VERSION = config.productionApi.__TMC_LANGS_VERSION__.replace(/"/g, "");

const copyTMCPythonModules = async (): Promise<void> => {
    const tmcPythonTester = path.join(__dirname, "..", "submodules", "tmc-python-tester");
    const testerDir = fs.readdirSync(tmcPythonTester);
    if (testerDir.length === 0) {
        throw new Error(
            "tmc-python-tester submodule is missing, you can initialise it with `git submodule init && git submodule update`",
        );
    }

    const module = path.join(tmcPythonTester, "tmc");
    const courseDirectory = path.join(path.join(__dirname, "resources", "test-python-course"));
    const pythonExercises = fs
        .readdirSync(courseDirectory, { withFileTypes: true })
        .filter((x) => x.isDirectory())
        .map((x) => path.join(courseDirectory, x.name));
    pythonExercises.forEach((exercise) => {
        const target = path.join(exercise, "tmc");
        console.log(`Copying tmc module from ${module} to ${target}`);
        ncp(module, target, () => {});
    });
    console.log("Modules copied!");
    await new Promise((res) => setTimeout(res, 1000));
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
        throw new Error("Failed to download from " + url);
    }
    const data = await res.blob();
    const buf = Buffer.from(new Uint8Array(await data.arrayBuffer()));
    fs.writeFileSync(langs, buf);
    fs.chmodSync(langs, 0o755);
    console.log(fileName, "downloaded!");
};

(async (): Promise<void> => {
    try {
        console.log("Copying tmc modules to python courses...");
        await copyTMCPythonModules();
        console.log("Starting server setup...");
        const langsVersion = getLangsCLIForPlatform(getPlatform(), TMC_LANGS_VERSION);
        await download(TMC_LANGS_DL_URL + langsVersion, langsVersion);
        console.log("Setup complete!");
    } catch (err) {
        console.error("Failed to download langs files.", err);
        process.exit(1);
    }
})();
