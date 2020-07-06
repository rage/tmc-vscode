/* eslint-disable @typescript-eslint/no-var-requires */
//@ts-check

"use strict";

const path = require("path");
const TerserPlugin = require("terser-webpack-plugin");
const merge = require("webpack-merge");

/**@type {import('webpack').ConfigurationFactory}*/
const config = () => {
    const isDevelopmentMode = process.env.DEBUG_MODE && process.env.DEBUG_MODE !== "production";
    console.log(
        `Webpack building in ${isDevelopmentMode ? "development" : "production"} configuration.`,
    );

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
