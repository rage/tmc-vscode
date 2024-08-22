//@ts-check

"use strict";

const glob = require("glob");
const path = require("path");
const TerserPlugin = require("terser-webpack-plugin");
const webpack = require("webpack");
const merge = require("webpack-merge").merge;

const { mockTmcLocalMooc, mockBackend, productionApi } = require("./config");

/**@type {() => import("webpack").Configuration} */
const config = () => {
    const isDevelopmentMode = process.env.NODE_ENV && process.env.NODE_ENV === "development";

    const apiConfig = (() => {
        switch (process.env.BACKEND) {
            case "mockTmcLocalMooc":
                return mockTmcLocalMooc;
            case "mockBackend":
                return mockBackend;
            default:
                return productionApi;
        }
    })();

    /**@type {import('webpack').Configuration}*/
    const commonConfig = {
        target: "node",
        entry: {
            extension: "./src/extension.ts",
            "testBundle.test": glob.globSync("./src/test/**/*.test.ts"),
            "integration.spec": glob.globSync("./src/test-integration/**/*.spec.ts"),
        },
        output: {
            path: path.resolve(__dirname, "dist"),
            filename: "[name].js",
            libraryTarget: "commonjs2",
            devtoolModuleFilenameTemplate: "../[resource-path]",
        },
        externals: {
            chai: "commonjs chai",
            mocha: "commonjs mocha",
            vscode: "commonjs vscode",
            "vscode-test": "commonjs vscode-test",
        },
        resolve: {
            extensions: [".ts", ".js"],
            alias: {
                handlebars: "handlebars/dist/handlebars.min.js",
            },
            // solves an issue with ts-loader with ttypescript
            // using the incorrect import paths for .d.ts files:
            // https://github.com/TypeStrong/ts-loader/issues/1501
            preferRelative: true,
            fallback: {
                async_hooks: false,
            },
        },
        node: {
            __dirname: false,
        },
        infrastructureLogging: {
            level: "log",
        },
        optimization: {
            splitChunks: {
                chunks: "all",
                name(module, chunks) {
                    return chunks.find((x) => x.name === "extension") ? "lib" : "testlib";
                },
            },
        },
        module: {
            rules: [
                {
                    test: /\.css$/i,
                    exclude: /node_modules/,
                    use: [
                        {
                            loader: "raw-loader",
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
                {
                    test: /\.md$/i,
                    exclude: /node_modules/,
                    use: [
                        {
                            loader: "raw-loader",
                        },
                    ],
                },
                {
                    test: /\.ts$/,
                    exclude: /node_modules/,
                    use: [
                        {
                            loader: "ts-loader",
                            options: {
                                compiler: "ts-patch/compiler",
                                configFile: "tsconfig.json",
                            },
                        },
                    ],
                },
            ],
        },
        plugins: [
            new webpack.DefinePlugin({
                __DEBUG_MODE__: JSON.stringify(isDevelopmentMode),
                ...apiConfig,
            }),
        ],
        watchOptions: {
            ignored: /node_modules/,
        },
    };
    /**@returns {import('webpack').Configuration}*/
    const devConfig = () => ({
        mode: "development",
        devtool: "inline-source-map",
    });
    // Type definition broken for the Nth time
    // /**@returns {import('webpack').Configuration}*/
    /**@returns {any} */
    const prodConfig = () => ({
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
    });

    console.log(
        `Webpack building in ${isDevelopmentMode ? "development" : "production"} configuration.`,
    );
    console.log(`Configured TMC backend: ${apiConfig.__TMC_BACKEND_URL__}`);
    console.log(`Configured MOOC backend: ${apiConfig.__MOOC_BACKEND_URL__}`);

    return merge(commonConfig, isDevelopmentMode ? devConfig() : prodConfig());
};

module.exports = config;
