//@ts-check

"use strict";

const glob = require("glob");
const path = require("path");
const TerserPlugin = require("terser-webpack-plugin");
const webpack = require("webpack");
const merge = require("webpack-merge").merge;

const { mockBackend, localTMCServer, productionApi } = require("./config");

/**@type {() => import("webpack").Configuration} */
const config = () => {
    const isDevelopmentMode = process.env.NODE_ENV && process.env.NODE_ENV === "development";

    const apiConfig = (() => {
        switch (process.env.BACKEND) {
            case "mockBackend":
                return mockBackend;
            case "localTMCServer":
                return localTMCServer;
            default:
                return productionApi;
        }
    })();

    // Workaround to an arbitrary type error for the time being.
    // Complains that string[] doesn't apply to type [string, ...string[]]
    // Since typescript 4.0.3 and webpack 5.1.3
    const [testHead, ...testTail] = glob.sync("./src/test/**/*.test.ts");

    /**@type {import('webpack').Configuration}*/
    const commonConfig = {
        target: "node",
        entry: {
            extension: "./src/extension.ts",
            "testBundle.test": [testHead, ...testTail],
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
        },
        node: {
            __dirname: false,
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
                                compiler: "ttypescript",
                                configFile: isDevelopmentMode
                                    ? "tsconfig.json"
                                    : "tsconfig.production.json",
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
    /**@returns {import('webpack').Configuration}*/
    const prodConfig = () => ({
        mode: "production",
        optimization: {
            minimizer: [
                // eslint-disable-next-line max-len
                // Incorrect type error: https://github.com/DefinitelyTyped/DefinitelyTyped/issues/48806#issuecomment-712654998
                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
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
    console.log(`Configured backend: ${apiConfig.__TMC_LANGS_ROOT_URL__}`);

    return merge(commonConfig, isDevelopmentMode ? devConfig() : prodConfig());
};

module.exports = config;
