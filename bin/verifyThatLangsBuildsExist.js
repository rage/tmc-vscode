// `src/utilities/env` is TypeScript and this script is plain node, so the require hook
// has to be in place before it is loaded.
require("tsx/cjs")

const config = require("../config")
// Destructured rather than `require(...).getAllLangsCLIs`: knip does not follow
// property access on a require, and would report the export dead.
const { getAllLangsCLIs } = require("../src/utilities/env")

const TMC_LANGS_DL_URL = config.productionApi.__TMC_LANGS_DL_URL__.replaceAll('"', "")
const TMC_LANGS_VERSION = config.productionApi.__TMC_LANGS_VERSION__.replaceAll('"', "")

const langsBuildExists = (url) => fetch(url, { method: "head" }).then((res) => res.status === 200)

async function main() {
  console.log("Verifying that all target TMC-langs builds exist...")
  let missingBuilds = false
  try {
    const allCLIs = getAllLangsCLIs(TMC_LANGS_VERSION)
    for (const cli of allCLIs) {
      const url = TMC_LANGS_DL_URL + cli
      if (!(await langsBuildExists(url))) {
        missingBuilds = true
        console.log("Failed to find", cli, "from", url)
      }
    }
    if (missingBuilds) {
      throw new Error("Some Langs builds were missing.")
    }
  } catch (e) {
    console.error("Verification resulted in error:", e.message)
    process.exit(1)
  }
  console.log("Found all langs builds!")
}

main()
