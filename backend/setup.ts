import fs from "fs"
import path from "path"

import { ZipArchive } from "archiver"
import { ncp } from "ncp"

import * as config from "../config"
import { getLangsCLIForPlatform, getPlatform } from "../src/utilities/env"

const TMC_LANGS_DL_URL = config.productionApi.__TMC_LANGS_DL_URL__.replaceAll('"', "")
const TMC_LANGS_VERSION = config.productionApi.__TMC_LANGS_VERSION__.replaceAll('"', "")

const copyTMCPythonModules = async (): Promise<void> => {
  const tmcPythonTester = path.join(__dirname, "..", "submodules", "tmc-python-tester")
  const testerDir = fs.readdirSync(tmcPythonTester)
  if (testerDir.length === 0) {
    throw new Error(
      "tmc-python-tester submodule is missing, you can initialise it with `git submodule init && git submodule update`",
    )
  }

  const module = path.join(tmcPythonTester, "tmc")
  const courseDirectory = path.join(path.join(__dirname, "resources", "test-python-course"))
  const pythonExercises = fs
    .readdirSync(courseDirectory, { withFileTypes: true })
    .filter((x) => x.isDirectory())
    .map((x) => path.join(courseDirectory, x.name))
  pythonExercises.forEach((exercise) => {
    const target = path.join(exercise, "tmc")
    console.log(`Copying tmc module from ${module} to ${target}`)
    ncp(module, target, () => {})
  })
  console.log("Modules copied!")
  await new Promise((res) => {
    setTimeout(res, 1000)
  })
  await Promise.all(
    pythonExercises.map(async (exercise) => {
      console.log(`Creating download archive for ${exercise}`)
      const archive = new ZipArchive()
      const archivePath = fs.createWriteStream(exercise + ".zip")
      archive.pipe(archivePath)
      archive.directory(exercise, false)
      await archive.finalize()
    }),
  )
  console.log("Archives created!")
}

const download = async (url: string, fileName: string): Promise<void> => {
  const langsPath = path.resolve(__dirname, "cli")
  if (!fs.existsSync(langsPath)) {
    fs.mkdirSync(langsPath, { recursive: true })
  }
  const langs = path.resolve(langsPath, fileName)
  if (fs.existsSync(langs)) {
    console.log("Skipping", fileName, "- already exists")
    return
  }

  console.log("Downloading", fileName, "from", url)
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error("Failed to download from " + url)
  }
  const data = await res.blob()
  const buf = Buffer.from(new Uint8Array(await data.arrayBuffer()))
  fs.writeFileSync(langs, buf)
  fs.chmodSync(langs, 0o755)
  console.log(fileName, "downloaded!")
}

// no top-level await: tsx transforms this file as CJS (backend has no
// "type": "module", and ESM would break the __dirname uses above)
const main = async (): Promise<void> => {
  console.log("Copying tmc modules to python courses...")
  await copyTMCPythonModules()
  console.log("Starting server setup...")
  const langsVersion = getLangsCLIForPlatform(getPlatform(), TMC_LANGS_VERSION)
  await download(TMC_LANGS_DL_URL + langsVersion, langsVersion)
  // the extension verifies the CLI against its .sha256 file and fails to
  // initialize if the mock backend cannot serve it
  await download(TMC_LANGS_DL_URL + langsVersion + ".sha256", langsVersion + ".sha256")
  console.log("Setup complete!")
}

// oxlint-disable-next-line unicorn/prefer-top-level-await -- tsx runs this as CJS
main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Setup failed.", err)
    process.exit(1)
  })
