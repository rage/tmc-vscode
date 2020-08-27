//@ts-check
"use strict";

const path = require("path");

const TMC_LANGS_RUST_VERSION = "0.1.0";

const localApi = {
    __ACCESS_TOKEN_URI__: JSON.stringify("http://localhost:4001/oauth/token"),
    __TMC_LANGS_CONFIG_DIR__: JSON.stringify(path.join(__dirname, "backend", "resources")),
    __TMC_LANGS_ROOT_URL__: JSON.stringify("http://localhost:4001"),
    __TMC_LANGS_RUST_DL_URL__: JSON.stringify("http://localhost:4001/langs/"),
    __TMC_LANGS_RUST_VERSION__: JSON.stringify(TMC_LANGS_RUST_VERSION),
};

/**@type {import("webpack").DefinePlugin.CodeValueObject}*/
const productionApi = {
    __ACCESS_TOKEN_URI__: JSON.stringify("https://tmc.mooc.fi/oauth/token"),
    __TMC_LANGS_CONFIG_DIR__: JSON.stringify(null),
    __TMC_LANGS_ROOT_URL__: JSON.stringify("https://tmc.mooc.fi"),
    __TMC_LANGS_RUST_DL_URL__: JSON.stringify("https://download.mooc.fi/tmc-langs-rust/"),
    __TMC_LANGS_RUST_VERSION__: JSON.stringify(TMC_LANGS_RUST_VERSION),
};

module.exports = { localApi, productionApi };
