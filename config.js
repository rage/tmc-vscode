//@ts-check
"use strict"

const path = require("path")

const { version: EXTENSION_VERSION } = require("./package.json")

const TMC_LANGS_RUST_VERSION = "0.42.1"

// VS Code build both test tiers download. Defaults to the minimum `engines.vscode`;
// CI overrides it to "stable" on one leg to catch breaks in the current release.
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
  // Same port as the TMC mock; test tiers override it via TMC_LANGS_MOOC_ROOT_URL.
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
