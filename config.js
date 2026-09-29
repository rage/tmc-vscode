//@ts-check
"use strict"

const path = require("path")

const { version: EXTENSION_VERSION } = require("./package.json")

const TMC_LANGS_RUST_VERSION = "0.40.0"

// VS Code build both test tiers download. Defaults to the minimum `engines.vscode`
// declares, so the version users may actually be on is the one exercised; CI
// overrides it to "stable" on one leg to catch a break in the current release.
const VSCODE_TEST_VERSION = process.env.VSCODE_TEST_VERSION || "1.100.0"

const mockTmcLocalMooc = {
  __TMC_BACKEND_URL__: JSON.stringify("http://localhost:4001"),
  __TMC_LANGS_CONFIG_DIR__: JSON.stringify(path.join(__dirname, "backend", "cli")),
  __TMC_LANGS_DL_URL__: JSON.stringify("http://localhost:4001/langs/"),
  __TMC_LANGS_VERSION__: JSON.stringify(TMC_LANGS_RUST_VERSION),
  __EXTENSION_VERSION__: JSON.stringify(EXTENSION_VERSION),
  __MOOC_BACKEND_URL__: JSON.stringify("http://project-331.local"),
}

const mockBackend = {
  __TMC_BACKEND_URL__: JSON.stringify("http://localhost:4001"),
  __TMC_LANGS_CONFIG_DIR__: JSON.stringify(path.join(__dirname, "backend", "cli")),
  __TMC_LANGS_DL_URL__: JSON.stringify("http://localhost:4001/langs/"),
  __TMC_LANGS_VERSION__: JSON.stringify(TMC_LANGS_RUST_VERSION),
  __EXTENSION_VERSION__: JSON.stringify(EXTENSION_VERSION),
  // The bundled mooc mock lives on the same port as the TMC one, but the test
  // tiers point the CLI at it with TMC_LANGS_MOOC_ROOT_URL, which overrides
  // this compile-time value anyway.
  __MOOC_BACKEND_URL__: JSON.stringify("https://courses.mooc.fi"),
}

const productionApi = {
  __TMC_BACKEND_URL__: JSON.stringify("https://tmc.mooc.fi"),
  __TMC_LANGS_CONFIG_DIR__: JSON.stringify(null),
  __TMC_LANGS_DL_URL__: JSON.stringify("https://download.mooc.fi/tmc-langs-rust/"),
  __TMC_LANGS_VERSION__: JSON.stringify(TMC_LANGS_RUST_VERSION),
  __EXTENSION_VERSION__: JSON.stringify(EXTENSION_VERSION),
  __MOOC_BACKEND_URL__: JSON.stringify("https://courses.mooc.fi"),
}

module.exports = {
  mockTmcLocalMooc,
  mockBackend,
  productionApi,
  VSCODE_TEST_VERSION,
}
