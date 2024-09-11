import typescriptEslint from "@typescript-eslint/eslint-plugin";
import prettier from "eslint-plugin-prettier";
import sortClassMembers from "eslint-plugin-sort-class-members";
import globals from "globals";
import tsParser from "@typescript-eslint/parser";
import path from "node:path";
import { fileURLToPath } from "node:url";
import js from "@eslint/js";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
    baseDirectory: __dirname,
    recommendedConfig: js.configs.recommended,
    allConfig: js.configs.all,
});

export default [
    {
        ignores: [
            "!**/.github",
            "**/dist",
            "**/node_modules",
            "**/out",
            "**/test-artifacts/",
            "**/test-resources/",
            "**/submodules/",
            "**/.vscode-test/",
            "**/vscode.proposed.d.ts",
            "**/build/",
        ],
    },
    ...compat.extends(
        "eslint:recommended",
        "plugin:@typescript-eslint/recommended",
        "plugin:prettier/recommended",
    ),
    {
        plugins: {
            "@typescript-eslint": typescriptEslint,
            prettier,
            "sort-class-members": sortClassMembers,
        },

        languageOptions: {
            globals: {
                ...globals.node,
                Atomics: "readonly",
                SharedArrayBuffer: "readonly",
            },

            parser: tsParser,
            ecmaVersion: 6,
            sourceType: "module",
        },

        rules: {
            "no-unused-vars": "off",

            "@typescript-eslint/no-unused-vars": [
                "warn",
                {
                    varsIgnorePattern: "^_",
                    argsIgnorePattern: "^_",
                    caughtErrorsIgnorePattern: "^_",
                    destructuredArrayIgnorePattern: "^_",
                },
            ],

            "@typescript-eslint/ban-ts-comment": [
                "error",
                {
                    "ts-ignore": "allow-with-description",
                },
            ],

            curly: "error",

            "sort-imports": [
                "error",
                {
                    ignoreCase: true,
                    ignoreDeclarationSort: true,
                },
            ],

            "@typescript-eslint/no-var-requires": "off",
        },
    },
    {
        files: ["**/*.ts", "**/*.tsx"],

        rules: {
            "@typescript-eslint/explicit-function-return-type": ["error"],
            "@typescript-eslint/explicit-module-boundary-types": ["error"],
            "@typescript-eslint/no-var-requires": ["error"],
        },
    },
    {
        files: ["**/*.test.ts", "**/*.spec.ts"],

        rules: {
            "@typescript-eslint/no-unused-expressions": "off",
        },
    },
    {
        files: ["**/*.js", "**/*.ts"],

        rules: {
            "@typescript-eslint/no-require-imports": "off",
        },
    },
];
