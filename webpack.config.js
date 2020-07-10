/* eslint-disable @typescript-eslint/no-var-requires */
//@ts-check

"use strict";

const path = require("path");
const TerserPlugin = require("terser-webpack-plugin");
const webpack = require("webpack");
const merge = require("webpack-merge");

/**@type {import('webpack').ConfigurationFactory}*/
const config = () => {
    const isDevelopmentMode = process.env.NODE_ENV && process.env.NODE_ENV === "development";
    const localBackend = process.env.BACKEND && process.env.BACKEND === "local";
    console.log(
        `Webpack building in ${isDevelopmentMode ? "development" : "production"} configuration.`,
    );
    console.log(`Using ${localBackend ? "localhost" : "production"} server.`);

    /**@type {import('webpack').Configuration}*/
    const commonConfig = {
        target: "node",
        entry: "./src/extension.ts",
        output: {
            path: path.resolve(__dirname, "dist"),
            filename: "extension.js",
            libraryTarget: "commonjs2",
            devtoolModuleFilenameTemplate: "../[resource-path]",
        },
        externals: {
            // vscode-module is created on-the-fly and must be excluded.
            vscode: "commonjs vscode",
        },
        resolve: {
            extensions: [".ts", ".js"],
            alias: {
                handlebars: "handlebars/dist/handlebars.min.js",
            },
        },
        module: {
            rules: [
                {
                    test: /\.ts$/,
                    exclude: /node_modules/,
                    use: [
                        {
                            loader: "ts-loader",
                            options: {
                                compiler: "ttypescript",
                                configFile: isDevelopmentMode
                                    ? "tsconfig.json"
                                    : "tsconfig.production.json",
                            },
                        },
                    ],
                },
                {
                    test: /\.jsx$/,
                    exclude: /node_modules/,
                    use: [
                        {
                            loader: "babel-loader",
                            options: {
                                presets: ["@babel/preset-env"],
                                plugins: [
                                    [
                                        "@babel/plugin-transform-react-jsx",
                                        { pragma: "createElement" },
                                    ],
                                ],
                            },
                        },
                    ],
                },
            ],
        },
        plugins: [
            new webpack.DefinePlugin({
                __DEBUG_MODE__: JSON.stringify(isDevelopmentMode),
                __ACCESS_TOKEN_URI__: JSON.stringify(
                    localBackend
                        ? "http://localhost:4001/oauth/token"
                        : "https://tmc.mooc.fi/oauth/token",
                ),
                __TMC_API_URL__: JSON.stringify(
                    localBackend ? "http://localhost:4001/" : "https://tmc.mooc.fi/api/v8/",
                ),
                __TMC_JAR_NAME__: JSON.stringify("tmc-langs-cli-0.8.5-SNAPSHOT.jar"),
                __TMC_JAR_URL__: JSON.stringify(
                    localBackend
                        ? "http://localhost:4001/langs"
                        : "https://download.mooc.fi/tmc-langs/tmc-langs-cli-0.8.5-SNAPSHOT.jar",
                ),
            }),
        ],
    };

    /**@type {import('webpack').Configuration}*/
    const devConfig = {
        mode: "development",
        devtool: "inline-source-map",
    };

    /**@type {import('webpack').Configuration}*/
    const prodConfig = {
        mode: "production",
        optimization: {
            minimizer: [
                new TerserPlugin({
                    terserOptions: {
                        keep_fnames: /createElement/,
                        mangle: {
                            reserved: ["createElement"],
                        },
                    },
                }),
            ],
        },
    };

    return merge(commonConfig, isDevelopmentMode ? devConfig : prodConfig);
};

module.exports = config;
