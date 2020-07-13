import { Router } from "express";
import fs from "fs";
import fetch from "node-fetch";
import path from "path";

import * as config from "../../config";

const LANGS_NAME = config.productionApi.__TMC_JAR_NAME__.replace(/"/g, "");
const LANGS_URL = config.productionApi.__TMC_JAR_URL__.replace(/"/g, "");

const download = async (): Promise<void> => {
    const langsPath = path.resolve(__dirname, "..", "resources");
    if (!fs.existsSync(langsPath)) {
        fs.mkdirSync(langsPath, { recursive: true });
    }
    const langs = path.resolve(langsPath, LANGS_NAME);
    if (!fs.existsSync(langs)) {
        console.log("Downloading langs");
        const res = await fetch(LANGS_URL);
        if (!res.ok) {
            throw "Failed";
        }
        fs.writeFileSync(langs, await res.buffer());
    }
};

const langs = download();

const langsRouter = Router();

langsRouter.get("/", (request, response) => {
    langs.then(() => {
        return response.sendFile(path.resolve(__dirname, "..", "resources", LANGS_NAME));
    });
});

export default langsRouter;
