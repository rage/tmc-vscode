// Some templates on this page are very specific, so this rule is disabled here.
/* eslint-disable max-len */

// Build time only globals defined in webpack configuration. These values are inlined when
// compiling.
declare const __ACCESS_TOKEN_URI__: string;
declare const __DEBUG_MODE__: boolean;
declare const __TMC_LANGS_CONFIG_DIR__: string | null;
declare const __TMC_LANGS_ROOT_URL__: string;
declare const __TMC_LANGS_RUST_DL_URL__: string;
declare const __TMC_LANGS_RUST_VERSION__: string;

import FAQ from "../../docs/FAQ.md";
import { SubmissionResultReport } from "../api/types";

export const ACCESS_TOKEN_URI = __ACCESS_TOKEN_URI__;
export const DEBUG_MODE = __DEBUG_MODE__;
export const TMC_LANGS_CONFIG_DIR = __TMC_LANGS_CONFIG_DIR__ || undefined;
export const TMC_LANGS_ROOT_URL = __TMC_LANGS_ROOT_URL__;
export const TMC_LANGS_RUST_DL_URL = __TMC_LANGS_RUST_DL_URL__;
export const TMC_LANGS_RUST_VERSION = __TMC_LANGS_RUST_VERSION__;

export const EXTENSION_ID = "moocfi.test-my-code";
export const OUTPUT_CHANNEL_NAME = "TestMyCode";

export const CLIENT_NAME = "vscode_plugin";
export const CLIENT_ID = "72065a25dc4d3e9decdf8f49174a3e393756478d198833c64f6e5584946394f0";
export const CLIENT_SECRET = "3e6c4df1992e4031d316ea1933e350e9658326a67efb2e65a5b15207bdc09ee8";

export const HIDE_META_FILES = {
    "**/__pycache__": true,
    "**/.available_points.json": true,
    "**/.tmc_test_results.json": true,
    "**/.tmcproject.yml": true,
    "**/tmc": true,
    "**/.settings": true,
    "**/.tmcproject.json": true,
    "**/.tmc.json": true,
};

export const SHOW_META_FILES = {
    "**/__pycache__": false,
    "**/.available_points.json": false,
    "**/.tmc_test_results.json": false,
    "**/.tmcproject.yml": false,
    "**/tmc": false,
    "**/.settings": false,
    "**/.tmcproject.json": false,
    "**/.tmc.json": false,
};

export const WATCHER_EXCLUDE = {
    "**/.vscode/**": true,
    "**/.tmc.json": true,
};

export const WORKSPACE_SETTINGS = {
    folders: [{ path: ".tmc" }],
    settings: {
        "workbench.editor.closeOnFileDelete": true,
        "files.autoSave": "onFocusChange",
        "files.exclude": { ...HIDE_META_FILES },
        "files.watcherExclude": { ...WATCHER_EXCLUDE },
    },
};

/** Delay for when TMC-Langs process should be killed. */
export const TMC_LANGS_TIMEOUT = 2 * 60 * 1000;

/**
 * Delay for notifications that offer a "remind me later" option.
 */
export const NOTIFICATION_DELAY = 30 * 60 * 1000;

export const EXERCISE_CHECK_INTERVAL = 30 * 60 * 1000;

export const EMPTY_HTML_DOCUMENT = `<html><head><meta http-equiv="${"Content-Security-Policy"}" content="default-src 'none';" /></head></html>`;

/**
 * If changed WORKSPACEROOTFILE is changed, remember to update
 * "workspaceContains:**\TMC-Readme.md", with the new name below
 */
export const WORKSPACE_ROOT_FILE = "TMC-Readme.md";

export const WORKSPACE_ROOT_FILE_TEXT = FAQ;

export const EXAM_TEST_RESULT = {
    testResult: {
        status: "PASSED",
        testResults: [
            {
                name: "Hidden Exam Test: hidden_test",
                successful: true,
                message: "Remember to submit your solution to the server for evaluation.",
                valgrindFailed: false,
                points: [],
                exception: [],
            },
        ],
        logs: {},
    },
    exerciseName: "part01-exam01",
    tmcLogs: {
        stdout: "",
        stderr: "",
    },
};

export const EXAM_SUBMISSION_RESULT: SubmissionResultReport = {
    api_version: 8,
    all_tests_passed: true,
    user_id: 0,
    login: "0",
    course: "0",
    exercise_name: "string",
    status: "ok",
    points: [],
    validations: "unknown",
    valgrind: null,
    submission_url: "",
    solution_url: null,
    submitted_at: "string",
    processing_time: 3,
    reviewed: false,
    requests_review: false,
    paste_url: null,
    message_for_paste: null,
    missing_review_points: [],
    test_cases: [
        {
            name: "Hidden Exam Test: hidden_test",
            successful: true,
            message: "Exam exercise sent to server successfully, you can now continue.",
            exception: null,
            detailed_message: null,
        },
    ],
};
