import { AI_OFF_SETTINGS, COURSE_LANGUAGE_IDS } from "../config/constants";
import { Logger } from "../utilities";
import type WorkspaceManager from "./workspaceManager";
import * as _ from "lodash";
import * as path from "path";
import * as vscode from "vscode";

/** `workspaceState` key of the persisted {@link Backoff}s, by target key. */
const BACKOFFS_KEY = "aiOffSettingsBackoffs";

/** Writes of one target a minute before it is left alone: {@link MIN_BACKOFF_MS} at first, doubling up to {@link MAX_BACKOFF_MS}. */
const MAX_WRITES_PER_MINUTE = 5;
const MIN_BACKOFF_MS = 5_000;
const MAX_BACKOFF_MS = 10 * 60_000;

/** The section whose write can restart the extension host: turning it on disables a running Copilot Chat. */
const RESTARTING_SECTION = "chat.disableAIFeatures";

/** The parts of {@link WorkspaceManager} that read and write the open course's settings. */
export type CourseWorkspaceSettings = Pick<
    WorkspaceManager,
    | "activeCourse"
    | "exerciseFolders"
    | "getStoredWorkspaceSetting"
    | "inspectSetting"
    | "onDidChangeExercises"
    | "replaceFolderSetting"
    | "replaceWorkspaceSetting"
    | "workspaceFileUri"
>;

/** What makes {@link AiRestriction} run a pass. */
export interface AiRestrictionEvents {
    onDidChangeConfiguration: vscode.Event<vscode.ConfigurationChangeEvent>;
    onDidOpenTextDocument: vscode.Event<vscode.TextDocument>;
    /** The course workspace file was saved or changed on disk. */
    onDidChangeWorkspaceFile: vscode.Event<unknown>;
    onDidChangeExerciseFolders: vscode.Event<unknown>;
    onDidChangeExtensions: vscode.Event<unknown>;
}

/**
 * One place a section is written: the workspace file's top level or one of its `[languageId]`
 * blocks, or the same in an exercise folder's `.vscode/settings.json`.
 */
interface SettingTarget {
    section: string;
    languageId: string | undefined;
    folder: vscode.Uri | undefined;
}

function targetKey({ section, languageId, folder }: SettingTarget): string {
    const key = languageId === undefined ? section : `[${languageId}]${section}`;
    return folder ? `${folder.fsPath}:${key}` : key;
}

/** Successful writes of one target, and how long it is left alone for; times are `Date.now()`. */
interface Backoff {
    writeTimes: number[];
    delayMs: number;
    retryAt: number;
}

/**
 * Keeps {@link AI_OFF_SETTINGS} in force in the open course workspace: writes them into its
 * `.code-workspace`, puts back a section the student or another extension changes, overrides
 * per-language user settings with `[languageId]` blocks of its own, and overrides an exercise
 * folder's own settings that turn AI back on.
 */
export default class AiRestriction implements vscode.Disposable {
    private readonly _disposables: vscode.Disposable[] = [];
    private _isDisposed = false;
    private _pass: Promise<void> | undefined;
    private _isPassRequested = false;
    private readonly _backoffs: Map<string, Backoff>;
    private _retryTimer: ReturnType<typeof setTimeout> | undefined;
    private _failureRetryDelayMs = MIN_BACKOFF_MS;
    private _failureRetryAt = 0;
    private readonly _knownLanguageIds = new Set<string>();
    private _overridableSections: Set<string> | undefined;
    private _hasLoggedWrite = false;

    /**
     * @param _state The workspace's own `ExtensionContext.workspaceState`; the backoff is kept
     * there because a write of {@link RESTARTING_SECTION} can restart the extension host.
     * @param events VS Code's own when omitted.
     */
    constructor(
        private readonly _workspace: CourseWorkspaceSettings,
        private readonly _state: vscode.Memento,
        events?: AiRestrictionEvents,
    ) {
        this._backoffs = new Map(
            Object.entries(_state.get<Record<string, Backoff>>(BACKOFFS_KEY) ?? {}),
        );
        const triggers = events ?? this._vscodeEvents();
        this._disposables.push(
            triggers.onDidChangeConfiguration((event) => {
                if (Object.keys(AI_OFF_SETTINGS).some((s) => event.affectsConfiguration(s))) {
                    void this.apply();
                }
            }),
            // Also fires when the student switches a document's language mode.
            triggers.onDidOpenTextDocument((document) => {
                if (!this._knownLanguageIds.has(document.languageId)) {
                    void this.apply();
                }
            }),
            triggers.onDidChangeWorkspaceFile(() => void this.apply()),
            triggers.onDidChangeExerciseFolders(() => void this.apply()),
            triggers.onDidChangeExtensions(() => {
                this._overridableSections = undefined;
                void this.apply();
            }),
        );
    }

    /**
     * Writes the settings that drifted, leaving one that keeps flipping back alone for a while
     * and retrying refused writes later. A call during a pass runs one more pass after it.
     * Never rejects.
     */
    public apply(): Promise<void> {
        if (this._isDisposed) {
            return Promise.resolve();
        }
        if (this._pass) {
            this._isPassRequested = true;
            return this._pass;
        }
        // Deferred, so `_pass` is set before a write can synchronously call back in here.
        this._pass = Promise.resolve().then(() => this._runPasses());
        return this._pass;
    }

    public dispose(): void {
        this._isDisposed = true;
        clearTimeout(this._retryTimer);
        this._disposables.forEach((x) => x.dispose());
    }

    private async _runPasses(): Promise<void> {
        try {
            do {
                this._isPassRequested = false;
                await this._applyOnce();
            } while (this._isPassRequested && !this._isDisposed);
        } catch (e) {
            Logger.error("Failed to apply the course's AI settings.", e);
        } finally {
            this._pass = undefined;
        }
    }

    private async _applyOnce(): Promise<void> {
        if (!this._workspace.activeCourse) {
            return;
        }
        const declared = Object.keys(AI_OFF_SETTINGS).filter(
            (section) => this._workspace.inspectSetting(section)?.defaultValue !== undefined,
        );
        const folders = this._workspace.exerciseFolders();
        const written: SettingTarget[] = [];
        let failureCount = 0;
        const write = async (target: SettingTarget): Promise<void> => {
            const outcome = await this._writeIfDrifted(target);
            if (outcome === "written") {
                written.push(target);
            } else if (outcome === "failed") {
                failureCount++;
            }
        };

        // Last, so a restart cannot cut off the other writes.
        const [restarting, others] = _.partition(declared, (s) => s === RESTARTING_SECTION);
        for (const section of others) {
            await write({ section, languageId: undefined, folder: undefined });
        }
        const overridable = others.filter((section) => this._isLanguageOverridable(section));
        const languageIds = this._languageIds(overridable, folders);
        // A per-language block is needed only where a language override beats a top level that
        // holds; written for one that does not, it would add a block for every course language.
        const heldAtTopLevel = overridable.filter(
            (section) =>
                this._desiredValue({ section, languageId: undefined, folder: undefined }) ===
                undefined,
        );
        for (const section of heldAtTopLevel) {
            for (const languageId of languageIds) {
                await write({ section, languageId, folder: undefined });
            }
        }
        for (const folder of folders) {
            for (const section of others) {
                await write({ section, languageId: undefined, folder });
            }
            for (const section of overridable) {
                for (const languageId of languageIds) {
                    await write({ section, languageId, folder });
                }
            }
        }
        for (const section of restarting) {
            await write({ section, languageId: undefined, folder: undefined });
            for (const folder of folders) {
                await write({ section, languageId: undefined, folder });
            }
        }

        if (failureCount > 0) {
            this._failureRetryAt = Date.now() + this._failureRetryDelayMs;
            this._failureRetryDelayMs = Math.min(this._failureRetryDelayMs * 2, MAX_BACKOFF_MS);
        } else {
            this._failureRetryAt = 0;
            this._failureRetryDelayMs = MIN_BACKOFF_MS;
        }
        this._scheduleRetry();

        if (written.length > 0) {
            const summary = `Turned AI assistance off in the course workspace through ${written.length} settings.`;
            if (this._hasLoggedWrite) {
                Logger.debug(summary, written.map(targetKey));
            } else {
                this._hasLoggedWrite = true;
                Logger.info(summary);
            }
        }
    }

    private async _writeIfDrifted(
        target: SettingTarget,
    ): Promise<"held" | "backedOff" | "written" | "failed"> {
        const desired = this._desiredValue(target);
        if (desired === undefined) {
            return "held";
        }
        const key = targetKey(target);
        if (!(await this._mayWrite(key)) || this._isDisposed) {
            return "backedOff";
        }
        // Recorded first: the write of RESTARTING_SECTION can end this extension host before it returns.
        const writeTime = await this._recordWrite(key);
        try {
            if (target.folder) {
                await this._workspace.replaceFolderSetting(
                    target.folder,
                    target.section,
                    desired,
                    target.languageId,
                );
            } else {
                await this._workspace.replaceWorkspaceSetting(
                    target.section,
                    desired,
                    target.languageId,
                );
            }
        } catch (e) {
            Logger.warn(`Could not write ${key} to turn off AI assistance.`, e);
            await this._forgetWrite(key, writeTime);
            return "failed";
        }
        return "written";
    }

    /**
     * What `target` must be written as, or `undefined` when it already holds. A folder or a
     * language block of the workspace file is written only where it turns AI back on; a folder
     * that sets nothing is left untouched.
     */
    private _desiredValue({ section, languageId, folder }: SettingTarget): unknown {
        const value = AI_OFF_SETTINGS[section];
        if (folder) {
            const inspection = this._workspace.inspectSetting(section, languageId, folder);
            const stored =
                languageId === undefined
                    ? inspection?.workspaceFolderValue
                    : inspection?.workspaceFolderLanguageValue;
            return stored === undefined || holds(stored, value) ? undefined : merged(stored, value);
        }
        if (languageId !== undefined) {
            const effective = this._workspace.inspectSetting(section, languageId)?.effectiveValue;
            return holds(effective, value) ? undefined : value;
        }
        const stored = this._workspace.getStoredWorkspaceSetting(section);
        const desired = merged(stored, value);
        return _.isEqual(stored, desired) ? undefined : desired;
    }

    /**
     * The course languages, the languages of the open documents, and every language something
     * overrides one of `sections` for: a language override at any scope beats the top level.
     */
    private _languageIds(sections: string[], folders: vscode.Uri[]): string[] {
        const languageIds = _.union(
            COURSE_LANGUAGE_IDS,
            vscode.workspace.textDocuments.map((document) => document.languageId),
            ...sections.flatMap((section) =>
                [undefined, ...folders].map(
                    (folder) =>
                        this._workspace.inspectSetting(section, undefined, folder)?.languageIds ??
                        [],
                ),
            ),
        );
        languageIds.forEach((languageId) => this._knownLanguageIds.add(languageId));
        return languageIds;
    }

    /**
     * `false` while a target something keeps flipping back is left alone. Only successful writes
     * count, so each one past the first in a minute means the previous one was undone. Kept per
     * target, so one fought-over setting costs the others nothing.
     */
    private async _mayWrite(key: string): Promise<boolean> {
        const backoff = this._backoffs.get(key);
        if (!backoff) {
            return true;
        }
        const now = Date.now();
        if (now < backoff.retryAt) {
            return false;
        }
        backoff.writeTimes = backoff.writeTimes.filter((t) => now - t < 60_000);
        if (backoff.writeTimes.length < MAX_WRITES_PER_MINUTE) {
            return true;
        }
        backoff.retryAt = now + backoff.delayMs;
        Logger.warn(
            `Something keeps turning ${key} back on in the course workspace; ` +
                `turning it off again in ${backoff.delayMs / 1000} s.`,
        );
        backoff.delayMs = Math.min(backoff.delayMs * 2, MAX_BACKOFF_MS);
        backoff.writeTimes = [];
        await this._saveBackoffs();
        return false;
    }

    /** @returns The time recorded, for {@link _forgetWrite}. */
    private async _recordWrite(key: string): Promise<number> {
        const now = Date.now();
        const backoff = this._backoffs.get(key) ?? {
            writeTimes: [],
            delayMs: MIN_BACKOFF_MS,
            retryAt: 0,
        };
        // A minute of calm since the last backoff forgives it.
        if (now - backoff.retryAt > 60_000) {
            backoff.delayMs = MIN_BACKOFF_MS;
        }
        backoff.writeTimes.push(now);
        this._backoffs.set(key, backoff);
        await this._saveBackoffs();
        return now;
    }

    private async _forgetWrite(key: string, writeTime: number): Promise<void> {
        const backoff = this._backoffs.get(key);
        const index = backoff?.writeTimes.lastIndexOf(writeTime) ?? -1;
        if (backoff && index >= 0) {
            backoff.writeTimes.splice(index, 1);
            await this._saveBackoffs();
        }
    }

    private async _saveBackoffs(): Promise<void> {
        await this._state.update(BACKOFFS_KEY, Object.fromEntries(this._backoffs));
    }

    /** Runs a pass when the earliest backoff or failure retry ends, which nothing else may trigger. */
    private _scheduleRetry(): void {
        clearTimeout(this._retryTimer);
        if (this._isDisposed) {
            return;
        }
        const now = Date.now();
        const retryAts = [...this._backoffs.values()]
            .map((b) => b.retryAt)
            .concat(this._failureRetryAt)
            .filter((t) => t > now);
        if (retryAts.length > 0) {
            this._retryTimer = setTimeout(() => void this.apply(), Math.min(...retryAts) - now);
        }
    }

    /**
     * Whether `section` may appear in a `[languageId]` block: every core editor option, and what an
     * extension declares so.
     */
    private _isLanguageOverridable(section: string): boolean {
        if (section.startsWith("editor.")) {
            return true;
        }
        this._overridableSections ??= new Set(
            vscode.extensions.all.flatMap((extension) => {
                const configuration: unknown = extension.packageJSON?.contributes?.configuration;
                const declarations = Array.isArray(configuration) ? configuration : [configuration];
                return declarations.flatMap((declaration) =>
                    Object.entries(
                        (declaration as { properties?: Record<string, { scope?: string }> })
                            ?.properties ?? {},
                    )
                        .filter(([, property]) => property?.scope === "language-overridable")
                        .map(([name]) => name),
                );
            }),
        );
        return this._overridableSections.has(section);
    }

    private _vscodeEvents(): AiRestrictionEvents {
        const file = this._workspace.workspaceFileUri;
        const watcher =
            file &&
            vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(
                    vscode.Uri.file(path.dirname(file.fsPath)),
                    path.basename(file.fsPath),
                ),
            );
        if (watcher) {
            this._disposables.push(watcher);
        }
        return {
            onDidChangeConfiguration: vscode.workspace.onDidChangeConfiguration,
            onDidOpenTextDocument: vscode.workspace.onDidOpenTextDocument,
            onDidChangeWorkspaceFile: anyEvent(
                (listener: (document: vscode.TextDocument) => void) =>
                    vscode.workspace.onDidSaveTextDocument((document) => {
                        if (document.uri.fsPath === file?.fsPath) {
                            listener(document);
                        }
                    }),
                ...(watcher ? [watcher.onDidChange, watcher.onDidCreate] : []),
            ),
            onDidChangeExerciseFolders: anyEvent(
                vscode.workspace.onDidChangeWorkspaceFolders,
                this._workspace.onDidChangeExercises,
            ),
            onDidChangeExtensions: vscode.extensions.onDidChange,
        };
    }
}

function anyEvent(...events: vscode.Event<unknown>[]): vscode.Event<unknown> {
    return (listener) => vscode.Disposable.from(...events.map((event) => event(listener)));
}

/** `off` written over `stored`; a per-language map keeps the entries `off` does not name. */
function merged(stored: unknown, off: unknown): unknown {
    return _.isPlainObject(off) && _.isPlainObject(stored)
        ? { ...(stored as object), ...(off as object) }
        : off;
}

/** Whether `effective` turns off what `off` does; a per-language map merges, so only its own entries count. */
function holds(effective: unknown, off: unknown): boolean {
    if (_.isPlainObject(off) && _.isPlainObject(effective)) {
        const entries = effective as Record<string, unknown>;
        return Object.entries(off as Record<string, unknown>).every(([key, value]) =>
            _.isEqual(entries[key], value),
        );
    }
    return _.isEqual(effective, off);
}
