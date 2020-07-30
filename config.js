//@ts-check
"use strict";

const TMC_JAR_NAME = "tmc-langs-cli-0.8.5-SNAPSHOT.jar";
const TMC_LANGS_RUST_VERSION = "0.1.10-alpha";

const localApi = {
    __ACCESS_TOKEN_URI__: JSON.stringify("http://localhost:4001/oauth/token"),
    __TMC_API_URL__: JSON.stringify("http://localhost:4001/"),
    __TMC_JAR_NAME__: JSON.stringify(TMC_JAR_NAME),
    __TMC_JAR_URL__: JSON.stringify(`http://localhost:4001/langs/${TMC_JAR_NAME}`),
    __TMC_LANGS_RUST_DL_URL__: JSON.stringify("http://localhost:4001/langs/"),
    __TMC_LANGS_RUST_VERSION__: JSON.stringify(TMC_LANGS_RUST_VERSION),
};

/**@type {import("webpack").DefinePlugin.CodeValueObject}*/
const productionApi = {
    __ACCESS_TOKEN_URI__: JSON.stringify("https://tmc.mooc.fi/oauth/token"),
    __TMC_API_URL__: JSON.stringify("https://tmc.mooc.fi/api/v8/"),
    __TMC_JAR_NAME__: JSON.stringify(TMC_JAR_NAME),
    __TMC_JAR_URL__: JSON.stringify(
        "https://download.mooc.fi/tmc-langs/tmc-langs-cli-0.8.5-SNAPSHOT.jar",
    ),
    __TMC_LANGS_RUST_DL_URL__: JSON.stringify("https://download.mooc.fi/tmc-langs-rust/"),
    __TMC_LANGS_RUST_VERSION__: JSON.stringify(TMC_LANGS_RUST_VERSION),
};

module.exports = { localApi, productionApi };
