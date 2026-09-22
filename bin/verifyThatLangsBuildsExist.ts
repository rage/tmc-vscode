import { productionApi } from "../config"
import { getAllLangsCLIs } from "../src/utilities/env"

const TMC_LANGS_DL_URL = productionApi.__TMC_LANGS_DL_URL__.replaceAll('"', "")
const TMC_LANGS_VERSION = productionApi.__TMC_LANGS_VERSION__.replaceAll('"', "")

const langsBuildExists = (url: string) =>
  fetch(url, { method: "head" }).then((res) => res.status === 200)

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
    console.error("Verification resulted in error:", e instanceof Error ? e.message : e)
    process.exit(1)
  }
  console.log("Found all langs builds!")
}

// oxlint-disable-next-line unicorn/prefer-top-level-await -- tsx runs this as CJS (no "type": "module")
main()
