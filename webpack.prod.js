/* eslint-disable @typescript-eslint/no-var-requires */
//@ts-check

"use strict";

const TerserPlugin = require("terser-webpack-plugin");
const merge = require("webpack-merge");

const common = require("./webpack.common");

/**@type {import('webpack').Configuration}*/
const devConfig = {
    mode: "production",
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
                            // Use extended tsconfig settings for production
                            configFile: "tsconfig.production.json",
                        },
                    },
                ],
            },
        ],
    },
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

module.exports = merge(common, devConfig);
