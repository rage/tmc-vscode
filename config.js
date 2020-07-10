//@ts-check
"use strict";

/**@type {import("webpack").DefinePlugin.CodeValueObject}*/
const localApi = {
    __ACCESS_TOKEN_URI__: JSON.stringify("http://localhost:4001/oauth/token"),
    __TMC_API_URL__: JSON.stringify("http://localhost:4001/"),
    __TMC_JAR_NAME__: JSON.stringify("tmc-langs-cli-0.8.5-SNAPSHOT.jar"),
    __TMC_JAR_URL__: JSON.stringify("http://localhost:4001/langs"),
};

/**@type {import("webpack").DefinePlugin.CodeValueObject}*/
const productionApi = {
    __ACCESS_TOKEN_URI__: JSON.stringify("https://tmc.mooc.fi/oauth/token"),
    __TMC_API_URL__: JSON.stringify("https://tmc.mooc.fi/api/v8/"),
    __TMC_JAR_NAME__: JSON.stringify("tmc-langs-cli-0.8.5-SNAPSHOT.jar"),
    __TMC_JAR_URL__: JSON.stringify(
        "https://download.mooc.fi/tmc-langs/tmc-langs-cli-0.8.5-SNAPSHOT.jar",
    ),
};

module.exports = { localApi, productionApi };
