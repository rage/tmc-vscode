// Some templates on this page are very specific, so this rule is disabled here.
/* eslint-disable max-len */

// Build time only globals defined in webpack configuration. These values are inlined when
// compiling.
declare const __DEBUG_MODE__: boolean;
declare const __TMC_BACKEND__URL__: string;
declare const __TMC_LANGS_CONFIG_DIR__: string | null;
declare const __TMC_LANGS_DL_URL__: string;
declare const __TMC_LANGS_VERSION__: string;

// @ts-ignore "No module found" error even though the file exists
import FAQ from "../../docs/FAQ.md";
import { TestResultData } from "../shared/shared";

export const DEBUG_MODE = __DEBUG_MODE__;
export const TMC_BACKEND_URL = __TMC_BACKEND__URL__;
export const TMC_LANGS_CONFIG_DIR = __TMC_LANGS_CONFIG_DIR__ || undefined;
export const TMC_LANGS_DL_URL = __TMC_LANGS_DL_URL__;
export const TMC_LANGS_VERSION = __TMC_LANGS_VERSION__;

export const CLIENT_NAME = "vscode_plugin";
export const EXTENSION_ID = "moocfi.test-my-code";
export const OUTPUT_CHANNEL_NAME = "TestMyCode";

/**
 * Delay for notifications that offer a "remind me later" option.
 */
export const NOTIFICATION_DELAY = 30 * 60 * 1000;

export const API_CACHE_LIFETIME = 5 * 60 * 1000;
export const CLI_PROCESS_TIMEOUT = 2 * 60 * 1000;
export const EXERCISE_CHECK_INTERVAL = 30 * 60 * 1000;

/** Minimum time that should be waited between submission attempts. */
export const MINIMUM_SUBMISSION_INTERVAL = 5 * 1000;

export const LOCAL_EXERCISE_AVAILABLE_POINTS_PLACEHOLDER = 1;
export const LOCAL_EXERCISE_AWARDED_POINTS_PLACEHOLDER =
    LOCAL_EXERCISE_AVAILABLE_POINTS_PLACEHOLDER;
export const LOCAL_EXERCISE_UNAWARDED_POINTS_PLACEHOLDER = 0;

export const HIDE_META_FILES = {
    "**/__pycache__": true,
    "**/.available_points.json": true,
    "**/.tmc_test_results.json": true,
    "**/.tmcproject.yml": true,
    "**/tmc": true,
    "**/.settings": true,
    "**/.tmcproject.json": true,
    "**/.tmc.json": true,
    "**/.tmc.lock": true,
    "**/.tmc_test_results.hmac.sha256": true,
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
    "**/.tmc.lock": false,
    "**/.tmc_test_results.hmac.sha256": false,
};

export const WATCHER_EXCLUDE = {
    "**/.vscode/**": true,
    "**/.tmc.json": true,
};

export const WORKSPACE_SETTINGS = {
    folders: [{ path: ".tmc" }],
    settings: {
        "explorer.decorations.colors": false,
        "files.autoSave": "onFocusChange",
        "files.exclude": { ...HIDE_META_FILES },
        "files.watcherExclude": { ...WATCHER_EXCLUDE },
        "problems.decorations.enabled": false,
        "workbench.editor.closeOnFileDelete": true,
    },
};

export const EMPTY_HTML_DOCUMENT = `<html><head><meta http-equiv="${"Content-Security-Policy"}" content="default-src 'none';" /></head></html>`;

/**
 * If changed WORKSPACEROOTFILE is changed, remember to update
 * "workspaceContains:**\TMC-Readme.md", with the new name below
 */
export const WORKSPACE_ROOT_FILE_NAME = "TMC-Readme.md";
export const WORKSPACE_ROOT_FILE_TEXT = FAQ;
export const WORKSPACE_ROOT_FOLDER_NAME = ".tmc";

export const EXAM_TEST_RESULT: TestResultData = {
    testResult: {
        status: "PASSED",
        testResults: [
            {
                name: "Hidden Exam Test: hidden_test",
                successful: true,
                message: "Remember to submit your solution to the server for evaluation.",
                points: [],
                exception: [],
            },
        ],
        logs: {},
    },
    id: 0,
    courseSlug: "",
    exerciseName: "part01-exam01",
    tmcLogs: {
        stdout: "",
        stderr: "",
    },
};
