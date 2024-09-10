module.exports = {
    root: true,
    env: {
        es6: true,
        node: true,
    },
    extends: [
        "eslint:recommended",
        "plugin:@typescript-eslint/recommended",
        "plugin:prettier/recommended",
    ],
    globals: {
        Atomics: "readonly",
        SharedArrayBuffer: "readonly",
    },
    parser: "@typescript-eslint/parser",
    parserOptions: {
        ecmaVersion: 6,
        sourceType: "module",
    },
    plugins: ["@typescript-eslint", "prettier", "sort-class-members"],
    rules: {
        "no-unused-vars": "off",
        // unused vars are allowed if they start with an underscore
        "@typescript-eslint/no-unused-vars": [
            "warn",
            {
                varsIgnorePattern: "^_",
                argsIgnorePattern: "^_",
                caughtErrorsIgnorePattern: "^_",
                destructuredArrayIgnorePattern: "^_",
            },
        ],

        "@typescript-eslint/ban-ts-comment": ["error", { "ts-ignore": "allow-with-description" }],
        curly: "error",
        "sort-imports": [
            "error",
            {
                ignoreCase: true,
                ignoreDeclarationSort: true,
            },
        ],
        "@typescript-eslint/no-var-requires": "off",
        // == disabled default configs from svelte template ==
        /*
        "@typescript-eslint/no-use-before-define": [
            "error",
            {
                classes: false,
                functions: false,
            },
        ],
        quotes: "off",
        "@typescript-eslint/quotes": ["error", "double", { avoidEscape: true }],
        "@typescript-eslint/explicit-function-return-type": "off",
        "@typescript-eslint/explicit-module-boundary-types": "off",
        "@typescript-eslint/no-empty-function": "off",
        "@typescript-eslint/no-var-requires": "off",
        "@typescript-eslint/semi": ["error"],
        "@typescript-eslint/lines-between-class-members": [
            "error",
            "always",
            { exceptAfterSingleLine: true },
        ],
        "@typescript-eslint/naming-convention": [
            "error",
            {
                selector: "function",
                format: ["camelCase"],
            },
            {
                selector: "method",
                modifiers: ["public"],
                format: ["camelCase"],
            },
            {
                selector: "method",
                modifiers: ["private"],
                format: ["camelCase"],
                leadingUnderscore: "require",
            },
            {
                selector: "property",
                modifiers: ["private"],
                format: ["camelCase"],
                leadingUnderscore: "require",
            },
            {
                selector: "typeLike",
                format: ["PascalCase"],
            },
        ],
        "max-len": [
            "warn",
            {
                code: 130,
                comments: 100,
                ignoreComments: false,
            },
        ],
        eqeqeq: ["error"],
        "sort-class-members/sort-class-members": [
            2,
            {
                order: [
                    "[static-properties]",
                    "[static-methods]",
                    "[properties]",
                    "[conventional-private-properties]",
                    "constructor",
                    "[methods]",
                    "[conventional-private-methods]",
                    "[everything-else]",
                ],
                accessorPairPositioning: "getThenSet",
            },
        ],
        "no-throw-literal": "warn",
        semi: "off",
        */
    },
    ignorePatterns: ["webview-ui/**"],
    overrides: [
        {
            files: ["*.ts", "*.tsx"],
            rules: {
                "@typescript-eslint/explicit-function-return-type": ["error"],
                "@typescript-eslint/explicit-module-boundary-types": ["error"],
                "@typescript-eslint/no-var-requires": ["error"],
            },
        },
        {
            files: ["*.test.ts", "*.spec.ts"],
            rules: {
                "@typescript-eslint/no-unused-expressions": "off",
            },
        },
    ],
};
