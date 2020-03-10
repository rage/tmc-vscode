//@ts-check

'use strict';

const merge = require('webpack-merge');
const common = require('./webpack.common');

/**@type {import('webpack').Configuration}*/
const devConfig = {
    mode: 'production',
    module: {
        rules: [
            {
                test: /\.ts$/,
                exclude: /node_modules/,
                use: [
                    {
                        loader: 'ts-loader',
                        options: {
                            compiler: 'ttypescript',
                            configFile: 'tsconfig.production.json' // Use extended tsconfig settings for production
                        }
                    }
                ]
            }
        ]
    }
}

module.exports = merge(common, devConfig);
