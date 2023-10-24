const DETECT_CSS_REGEX = /\S+:\s+[^\n]+;/;
const DETECT_PX_REGEX = /^\d+px$/;
const DETECT_REM_REGEX = /^\d+rem$/;
const DETECT_EM_REGEX = /^\d+em$/;
module.exports = {
    root: true,
    env: {
        es6: true,
        node: true,
    },
    extends: [
        "eslint:recommended",
        "plugin:@typescript-eslint/recommended",
        "plugin:import/errors",
        "plugin:import/warnings",
        "plugin:import/typescript",
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
    plugins: ["@typescript-eslint", "import", "prettier", "sort-class-members"],
    settings: {
        "import/core-modules": ["vscode"],
    },
    rules: {
        // == custom configs ==
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
        "import/no-named-as-default": "off",
        curly: "error",
        // == enabled default configs from svelte template ==
        "sort-imports": [
            "error",
            {
                ignoreCase: true,
                ignoreDeclarationSort: true,
            },
        ],
        "import/order": [
            "error",
            {
                alphabetize: {
                    order: "asc",
                },
                groups: [["builtin", "external"], "parent", "sibling", "index"],
                "newlines-between": "always",
            },
        ],
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
    ],
};
