// @ts-expect-error "No module found" error even though the file exists
import FAQ from "../../docs/FAQ.md"
import type { BackendKind } from "../shared/shared"

// Build time only globals defined in the esbuild configuration (esbuild.mjs
// `define`, sourced from config.js). These values are inlined when bundling.
declare const __DEBUG_MODE__: boolean
declare const __TMC_BACKEND_URL__: string
declare const __TMC_LANGS_CONFIG_DIR__: string | null
declare const __TMC_LANGS_DL_URL__: string
declare const __TMC_LANGS_VERSION__: string
declare const __MOOC_BACKEND_URL__: string
declare const __EXTENSION_VERSION__: string

export const DEBUG_MODE = __DEBUG_MODE__
export const TMC_BACKEND_URL = __TMC_BACKEND_URL__
export const TMC_LANGS_CONFIG_DIR = __TMC_LANGS_CONFIG_DIR__ || undefined
export const TMC_LANGS_DL_URL = __TMC_LANGS_DL_URL__
export const TMC_LANGS_VERSION = __TMC_LANGS_VERSION__
export const MOOC_BACKEND_URL = __MOOC_BACKEND_URL__

/** This build's `package.json` version, inlined so it needs no extension-registry lookup. */
export const EXTENSION_VERSION = __EXTENSION_VERSION__

export const CLIENT_NAME = "vscode_plugin"
export const EXTENSION_ID = "moocfi.test-my-code"
export const OUTPUT_CHANNEL_NAME = "TestMyCode"

/**
 * Delay for notifications that offer a "remind me later" option.
 */
export const NOTIFICATION_DELAY = 30 * 60 * 1000

export const API_CACHE_LIFETIME = 5 * 60 * 1000
export const CLI_PROCESS_TIMEOUT = 2 * 60 * 1000

/**
 * The CLI polls for test results with no timeout of its own, so this is the only bound on a submit;
 * keep it above the worst realistic sandbox queue wait or a queued submission gets killed.
 */
export const SUBMIT_PROCESS_TIMEOUT = 2 * 60 * 60 * 1000
export const EXERCISE_CHECK_INTERVAL = 30 * 60 * 1000

/** Minimum time that should be waited between submission attempts. */
export const MINIMUM_SUBMISSION_INTERVAL = 5 * 1000

export const LOCAL_EXERCISE_AVAILABLE_POINTS_PLACEHOLDER = 1
export const LOCAL_EXERCISE_AWARDED_POINTS_PLACEHOLDER = LOCAL_EXERCISE_AVAILABLE_POINTS_PLACEHOLDER
export const LOCAL_EXERCISE_UNAWARDED_POINTS_PLACEHOLDER = 0

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
}

/** Derived, so a glob added to {@link HIDE_META_FILES} cannot be missing here. */
export const SHOW_META_FILES: Record<string, boolean> = Object.fromEntries(
  Object.keys(HIDE_META_FILES).map((glob) => [glob, false]),
)

export const WATCHER_EXCLUDE = {
  "**/.vscode/**": true,
  "**/.tmc.json": true,
}

/** VS Code language ids of the exercises the language plugins handle, plus the prose files around them. */
export const COURSE_LANGUAGE_IDS = [
  "c",
  "cpp",
  "csharp",
  "java",
  "javascript",
  "markdown",
  "plaintext",
  "python",
  "r",
  "typescript",
]

// Per-language maps merge across scopes, so a user-scope `{"python": true}` would beat a bare
// `{"*": false}`: every course language is named.
const OFF_FOR_COURSE_LANGUAGES = {
  "*": false,
  ...Object.fromEntries(COURSE_LANGUAGE_IDS.map((languageId) => [languageId, false])),
}

/**
 * The settings that turn AI assistance off in a course workspace, written into its
 * `.code-workspace` unless the course allows AI. Every key must be window-, resource- or
 * language-scoped: a workspace file cannot hold application or machine settings.
 */
export const AI_OFF_SETTINGS: Readonly<Record<string, unknown>> = {
  // The only core switch that also reaches third-party ghost text.
  "editor.inlineSuggest.enabled": false,
  "chat.agent.enabled": false,
  "chat.extensionTools.enabled": false,
  "chat.mcp.access": "none",
  "chat.plugins.enabled": false,
  "github.copilot.enable": OFF_FOR_COURSE_LANGUAGES,
  "github.copilot.nextEditSuggestions.enabled": false,
  "github.copilot.editor.enableCodeActions": false,
  "github.copilot.renameSuggestions.triggerAutomatically": false,
  "github.copilot.chat.reviewSelection.enabled": false,
  "github.copilot.chat.reviewAgent.enabled": false,
  "codeium.enableConfig": OFF_FOR_COURSE_LANGUAGES,
  "codeium.enableCodeLens": false,
  "codeium.enableSearch": false,
  "codeium.enableExplainProblem": false,
  "codeium.disableSupercomplete": true,
  "codeium.disableTabJump": true,
  // Tabnine has no enable switch, and answers `editor.inlineSuggest.enabled` by moving to the suggest list.
  "tabnine.disableFileRegex": [".*"],
  "tabnine.codeLensEnabled": false,
  "continue.enableTabAutocomplete": false,
  "continue.enableNextEdit": false,
  "continue.enableQuickActions": false,
  "continue.disableQuickFix": true,
  "continue.showInlineTip": false,
  "cody.suggestions.mode": "off",
  "cody.autocomplete.languages": OFF_FOR_COURSE_LANGUAGES,
  "cody.codeActions.enabled": false,
  "cody.commandHints.enabled": false,
  "geminicodeassist.enable": false,
  "geminicodeassist.inlineSuggestions.enableAuto": false,
  "geminicodeassist.inlineSuggestions.nextEditPredictions": false,
  // An allow-list: empty enables no language.
  "geminicodeassist.languages": [],
  "supermaven.enable": OFF_FOR_COURSE_LANGUAGES,
  "supermaven.enableFixWithSupermaven": false,
  "supermaven.enableJumpSuggestions": false,
  "supermaven.enableDeleteSuggestions": false,
  "roo-cline.enableCodeActions": false,
  "kilo-code.new.autocomplete.enableAutoTrigger": false,
  "kilo-code.new.autocomplete.enableSmartInlineTaskKeybinding": false,
  "kilo-code.new.autocomplete.enableChatAutocomplete": false,
  "augment.completions.enableAutomaticCompletions": false,
  "augment.completions.disableCompletionsByLanguage": COURSE_LANGUAGE_IDS,
  "intellicodeCompletions.language.javascript": false,
  "intellicodeCompletions.language.python": false,
  "intellicodeCompletions.language.typescript": false,
  "vsintellicode.java.completionsEnabled": false,
  "vsintellicode.python.completionsEnabled": false,
  "vsintellicode.typescript.completionsEnabled": false,
  "genieai.quickFix.enable": false,
  "genieai.enableGenerateCommitMessage": false,
  // Last: turning it on disables Copilot Chat and restarts the extension host, which would cut
  // off any write still to come.
  "chat.disableAIFeatures": true,
}

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
}

/**
 * If changed WORKSPACEROOTFILE is changed, remember to update
 * "workspaceContains:**\TMC-Readme.md", with the new name below
 */
export const WORKSPACE_ROOT_FILE_NAME = "TMC-Readme.md"
export const WORKSPACE_ROOT_FILE_TEXT = FAQ
export const WORKSPACE_ROOT_FOLDER_NAME = ".tmc"

/**
 * Settings key for a course's manually-closed exercises, namespaced by
 * backend since a tmc and mooc course can share a slug. See
 * `backendNamespacing.ts` for the legacy-key migration.
 */
export function closedExercisesSettingKey(backend: BackendKind, courseName: string): string {
  return `closed-exercises-for:${backend}:${courseName}`
}

/** The pre-namespacing key shape. Only referenced by the migration. */
export function legacyClosedExercisesSettingKey(courseName: string): string {
  return `closed-exercises-for:${courseName}`
}

/** Basename of a course's `.code-workspace` file; backend-tagged for the same collision reason as {@link closedExercisesSettingKey}. */
export function workspaceFileName(courseName: string, backend: BackendKind): string {
  return `${courseName}-${backend}.code-workspace`
}

/** The pre-namespacing workspace filename. Only referenced by the migration. */
export function legacyWorkspaceFileName(courseName: string): string {
  return `${courseName}.code-workspace`
}
