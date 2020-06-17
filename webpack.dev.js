/* eslint-disable @typescript-eslint/no-var-requires */
//@ts-check

"use strict";

const merge = require("webpack-merge");
const common = require("./webpack.common");

/**@type {import('webpack').Configuration}*/
const devConfig = {
    mode: "development",
    devtool: "inline-source-map",
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
                            configFile: "tsconfig.json",
                        },
                    },
                ],
            },
        ],
    },
};

module.exports = merge(common, devConfig);
