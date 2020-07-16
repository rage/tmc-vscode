// Some templates on this page are very specific, so this rule is disabled here.
/* eslint-disable max-len */

// Build time only globals defined in webpack configuration. These values are inlined when
// compiling.
declare const __ACCESS_TOKEN_URI__: string;
declare const __DEBUG_MODE__: boolean;
declare const __TMC_API_URL__: string;
declare const __TMC_JAR_NAME__: string;
declare const __TMC_JAR_URL__: string;
declare const __TMC_LANGS_RUST_DL_URL__: string;
declare const __TMC_LANGS_RUST_VERSION__: string;

import { SubmissionResultReport } from "../api/types";

export const ACCESS_TOKEN_URI = __ACCESS_TOKEN_URI__;
export const DEBUG_MODE = __DEBUG_MODE__;
export const TMC_API_URL = __TMC_API_URL__;
export const TMC_JAR_NAME = __TMC_JAR_NAME__;
export const TMC_JAR_URL = __TMC_JAR_URL__;
export const TMC_LANGS_RUST_DL_URL = __TMC_LANGS_RUST_DL_URL__;
export const TMC_LANGS_RUST_VERSION = __TMC_LANGS_RUST_VERSION__;

export const EXTENSION_ID = "moocfi.test-my-code";
export const OUTPUT_CHANNEL_NAME = "TestMyCode";
export const JAVA_ZIP_URLS: {
    linux32?: string;
    linux64?: string;
    windows32?: string;
    windows64?: string;
} = {
    linux64: "https://download.mooc.fi/tmc-vscode/OpenJDK8U-jre_x64_linux_hotspot_8u252b09.zip",
    windows32:
        "https://download.mooc.fi/tmc-vscode/OpenJDK8U-jre_x86-32_windows_hotspot_8u252b09.zip",
    windows64: "https://download.mooc.fi/tmc-vscode/OpenJDK8U-jre_x64_windows_hotspot_8u252b09.zip",
};
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

export const WORKSPACE_SETTINGS_INSIDER = {
    folders: [{ path: ".tmc" }],
    settings: {
        "workbench.editor.closeOnFileDelete": true,
        "files.autoSave": "onFocusChange",
        "files.exclude": { ...HIDE_META_FILES },
        "files.watcherExclude": { ...WATCHER_EXCLUDE },
    },
};

export const WORKSPACE_SETTINGS = {
    folders: [{ path: "Exercises" }],
    settings: {
        "workbench.editor.closeOnFileDelete": true,
        "files.autoSave": "onFocusChange",
        "files.exclude": { ...HIDE_META_FILES },
        "files.watcherExclude": { ...WATCHER_EXCLUDE },
        "python.terminal.executeInFileDir": true,
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
 * "workspaceContains:**\TMC-Readme.txt", with the new name below
 */
export const WORKSPACE_ROOT_FILE = "TMC-Readme.txt";

export const WORKSPACE_ROOT_FILE_TEXT = `This folder should be the first folder of every TMC Workspaces.
Folder is in every workspace so that Visual Studio Code doesn't restart when opening and closing exercises via our extension.
Please do not remove/move/delete this folder, otherwise the TMC extension will not work properly.
This folder will be removed once Visual Studio Code deprecates the rootPath folder in workspaces and doesn't restart extensions.
Read more: https://github.com/microsoft/vscode/issues/69335`;

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
