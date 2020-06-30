/* eslint-disable @typescript-eslint/no-var-requires */
//@ts-check

"use strict";

const path = require("path");

/**@type {import('webpack').Configuration}*/
const config = {
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
                test: /\.jsx$/,
                exclude: /node_modules/,
                use: [
                    {
                        loader: "babel-loader",
                        options: {
                            presets: ["@babel/preset-env"],
                            plugins: [
                                ["@babel/plugin-transform-react-jsx", { pragma: "createElement" }],
                            ],
                        },
                    },
                ],
            },
        ],
    },
};

module.exports = config;
