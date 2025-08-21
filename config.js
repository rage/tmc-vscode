//@ts-check
"use strict";

const path = require("path");

const TMC_LANGS_RUST_VERSION = "0.38.1";

const mockTmcLocalMooc = {
    __TMC_BACKEND_URL__: JSON.stringify("http://localhost:4001"),
    __TMC_LANGS_CONFIG_DIR__: JSON.stringify(path.join(__dirname, "backend", "cli")),
    __TMC_LANGS_DL_URL__: JSON.stringify("http://localhost:4001/langs/"),
    __TMC_LANGS_VERSION__: JSON.stringify(TMC_LANGS_RUST_VERSION),
    __MOOC_BACKEND_URL__: JSON.stringify("http://project-331.local"),
};

const mockBackend = {
    __TMC_BACKEND_URL__: JSON.stringify("http://localhost:4001"),
    __TMC_LANGS_CONFIG_DIR__: JSON.stringify(path.join(__dirname, "backend", "cli")),
    __TMC_LANGS_DL_URL__: JSON.stringify("http://localhost:4001/langs/"),
    __TMC_LANGS_VERSION__: JSON.stringify(TMC_LANGS_RUST_VERSION),
    // no mock mooc backend yet
    __MOOC_BACKEND_URL__: JSON.stringify("https://courses.mooc.fi"),
};

const productionApi = {
    __TMC_BACKEND_URL__: JSON.stringify("https://tmc.mooc.fi"),
    __TMC_LANGS_CONFIG_DIR__: JSON.stringify(null),
    __TMC_LANGS_DL_URL__: JSON.stringify("https://download.mooc.fi/tmc-langs-rust/"),
    __TMC_LANGS_VERSION__: JSON.stringify(TMC_LANGS_RUST_VERSION),
    __MOOC_BACKEND_URL__: JSON.stringify("https://courses.mooc.fi"),
};

module.exports = { mockTmcLocalMooc, mockBackend, productionApi };
