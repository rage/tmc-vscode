const fetch = require("node-fetch");

const config = require("../config");
const getAllLangsCLIs = require("../src/utils/env").getAllLangsCLIs;

const TMC_LANGS_DL_URL = config.productionApi.__TMC_LANGS_DL_URL__.replace(/"/g, "");
const TMC_LANGS_VERSION = config.productionApi.__TMC_LANGS_VERSION__.replace(/"/g, "");

const langsBuildExists = (url) =>
    fetch.default(url, { method: "head" }).then((res) => res.status === 200);

async function main() {
    console.log("Verifying that all target TMC-langs builds exist...");
    let missingBuilds = false;
    try {
        const allCLIs = getAllLangsCLIs(TMC_LANGS_VERSION);
        for (const cli of allCLIs) {
            const url = TMC_LANGS_DL_URL + cli;
            if (!(await langsBuildExists(url))) {
                missingBuilds = true;
                console.log("Failed to find", cli, "from", url);
            }
        }
        if (missingBuilds) {
            throw new Error("Some Langs builds were missing.");
        }
    } catch (e) {
        console.error("Verification resulted in error:", e.message);
        process.exit(1);
    }
    console.log("Looks good!");
}

main();
