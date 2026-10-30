import AiRestriction, {
    AiRestrictionEvents,
    CourseWorkspaceSettings,
} from "../../api/aiRestriction";
import { SettingInspection } from "../../api/workspaceManager";
import { AI_OFF_SETTINGS } from "../../config/constants";
import { Logger } from "../../utilities";
import { createMockMemento } from "../mocks/vscode";
import { expect } from "chai";
import * as _ from "lodash";
import * as vscode from "vscode";

const AI_SECTIONS = Object.keys(AI_OFF_SETTINGS);
const INLINE_SUGGEST = "editor.inlineSuggest.enabled";
const EXERCISE_FOLDER = vscode.Uri.file("/tmc/projects/python-course/loops");

function keyOf(section: string, languageId?: string): string {
    return languageId === undefined ? section : `[${languageId}]${section}`;
}

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A course workspace as `AiRestriction` sees it, with every write recorded. Each scope maps
 * `section`, or `[languageId]section` for a language override, to its value.
 */
class FakeCourseWorkspace implements CourseWorkspaceSettings {
    public activeCourse: string | undefined = "python-course";
    public workspaceFileUri = vscode.Uri.file("/tmc/workspaces/python-course.code-workspace");
    /** The workspace file. */
    public readonly stored = new Map<string, unknown>();
    public readonly user = new Map<string, unknown>();
    /** The exercise folder's `.vscode/settings.json`. */
    public readonly folder = new Map<string, unknown>();
    public folders: vscode.Uri[] = [EXERCISE_FOLDER];
    /** What VS Code declares; a section missing here belongs to an extension not installed. */
    public readonly defaults = new Map<string, unknown>(
        AI_SECTIONS.map((section) => [section, section === INLINE_SUGGEST ? true : null]),
    );

    /** Keys whose writes VS Code refuses. */
    public readonly rejected = new Set<string>();
    public readonly writtenKeys: string[] = [];
    public writeDelayMs = 0;
    public writesInFlight = 0;
    public maxWritesInFlight = 0;
    public onWrite: (section: string, languageId: string | undefined) => void = () => {};
    public onInspect: () => void = () => {};
    public readonly exercisesChanged = new vscode.EventEmitter<void>();
    public readonly onDidChangeExercises = this.exercisesChanged.event;

    public exerciseFolders(): vscode.Uri[] {
        return this.folders;
    }

    public replaceWorkspaceSetting(
        section: string,
        value: unknown,
        languageId?: string,
    ): Promise<void> {
        return this._write(this.stored, keyOf(section, languageId), value, section, languageId);
    }

    public replaceFolderSetting(
        folder: vscode.Uri,
        section: string,
        value: unknown,
        languageId?: string,
    ): Promise<void> {
        expect(folder.fsPath).to.equal(EXERCISE_FOLDER.fsPath);
        const key = keyOf(section, languageId);
        return this._write(this.folder, key, value, section, languageId, `folder:${key}`);
    }

    public getStoredWorkspaceSetting(section: string): unknown {
        return this.stored.get(section);
    }

    /** Resolves like VS Code: a language override at any scope beats every scope's plain value. */
    public inspectSetting(
        section: string,
        languageId?: string,
        folder?: vscode.Uri,
    ): SettingInspection {
        this.onInspect();
        const scopes = [this.defaults, this.user, this.stored, folder ? this.folder : new Map()];
        const plain = scopes.map((s) => s.get(section));
        const language =
            languageId === undefined ? [] : scopes.map((s) => s.get(keyOf(section, languageId)));
        const effectiveValue = [...plain, ...language].reduce<unknown>((winner, value) => {
            if (value === undefined) {
                return winner;
            }
            return _.isPlainObject(winner) && _.isPlainObject(value)
                ? { ...(winner as object), ...(value as object) }
                : value;
        }, undefined);
        const languageIds = scopes.slice(1).flatMap((scope) =>
            [...scope.keys()].flatMap((key) => {
                const match = /^\[(.+)\](.+)$/.exec(key);
                return match?.[2] === section ? [match[1]] : [];
            }),
        );
        return {
            key: section,
            defaultValue: plain[0],
            globalValue: plain[1],
            workspaceValue: plain[2],
            workspaceFolderValue: plain[3],
            defaultLanguageValue: language[0],
            globalLanguageValue: language[1],
            workspaceLanguageValue: language[2],
            workspaceFolderLanguageValue: language[3],
            languageIds: _.uniq(languageIds),
            effectiveValue,
        };
    }

    private async _write(
        scope: Map<string, unknown>,
        key: string,
        value: unknown,
        section: string,
        languageId: string | undefined,
        writtenKey = key,
    ): Promise<void> {
        if (this.rejected.has(writtenKey)) {
            throw new Error("Unable to write into the workspace configuration file.");
        }
        this.writesInFlight++;
        this.maxWritesInFlight = Math.max(this.maxWritesInFlight, this.writesInFlight);
        this.writtenKeys.push(writtenKey);
        scope.set(key, value);
        this.onWrite(section, languageId);
        if (this.writeDelayMs > 0) {
            await wait(this.writeDelayMs);
        }
        this.writesInFlight--;
    }
}

function changeOf(section: string): vscode.ConfigurationChangeEvent {
    return { affectsConfiguration: (asked: string) => asked === section };
}

function holdEverySetting(workspace: FakeCourseWorkspace): void {
    for (const [section, value] of Object.entries(AI_OFF_SETTINGS)) {
        workspace.stored.set(section, value);
    }
}

suite("AiRestriction class", function () {
    let workspace: FakeCourseWorkspace;
    let state: vscode.Memento;
    let configurationChanges: vscode.EventEmitter<vscode.ConfigurationChangeEvent>;
    let documentOpens: vscode.EventEmitter<vscode.TextDocument>;
    let workspaceFileChanges: vscode.EventEmitter<void>;
    let extensionChanges: vscode.EventEmitter<void>;
    let restriction: AiRestriction;
    let warnings: string[];
    const realWarn = Logger.warn;

    function createRestriction(): AiRestriction {
        const events: AiRestrictionEvents = {
            onDidChangeConfiguration: configurationChanges.event,
            onDidOpenTextDocument: documentOpens.event,
            onDidChangeWorkspaceFile: workspaceFileChanges.event,
            onDidChangeExerciseFolders: workspace.onDidChangeExercises,
            onDidChangeExtensions: extensionChanges.event,
        };
        return new AiRestriction(workspace, state, events);
    }

    setup(function () {
        workspace = new FakeCourseWorkspace();
        state = createMockMemento();
        configurationChanges = new vscode.EventEmitter();
        documentOpens = new vscode.EventEmitter();
        workspaceFileChanges = new vscode.EventEmitter();
        extensionChanges = new vscode.EventEmitter();
        warnings = [];
        Logger.warn = (...params: unknown[]): void => {
            warnings.push(String(params[0]));
        };
        restriction = createRestriction();
    });

    teardown(function () {
        Logger.warn = realWarn;
        restriction.dispose();
        configurationChanges.dispose();
        documentOpens.dispose();
        workspaceFileChanges.dispose();
        extensionChanges.dispose();
        workspace.exercisesChanged.dispose();
    });

    test("writes every setting, the one that restarts the extension host last", async function () {
        await restriction.apply();

        expect(Object.fromEntries(workspace.stored)).to.deep.equal(AI_OFF_SETTINGS);
        expect(_.last(workspace.writtenKeys)).to.equal("chat.disableAIFeatures");
    });

    test("writes nothing when the workspace file already holds the settings", async function () {
        holdEverySetting(workspace);

        await restriction.apply();

        expect(workspace.writtenKeys).to.be.empty;
    });

    test("writes only the setting that drifted", async function () {
        holdEverySetting(workspace);
        workspace.stored.set("chat.disableAIFeatures", false);

        await restriction.apply();

        expect(workspace.writtenKeys).to.deep.equal(["chat.disableAIFeatures"]);
    });

    test("turns off each course language in a per-language map and keeps other entries", async function () {
        workspace.stored.set("github.copilot.enable", { python: true, rust: true });

        await restriction.apply();

        expect(workspace.stored.get("github.copilot.enable")).to.deep.equal({
            ...(AI_OFF_SETTINGS["github.copilot.enable"] as object),
            rust: true,
        });
    });

    test("skips a setting no installed extension declares", async function () {
        AI_SECTIONS.filter(
            (s) => s.startsWith("codeium.") || s === "chat.disableAIFeatures",
        ).forEach((s) => workspace.defaults.delete(s));

        await restriction.apply();

        expect(workspace.writtenKeys.filter((s) => s.startsWith("codeium."))).to.be.empty;
        expect(workspace.stored.has("chat.disableAIFeatures")).to.be.false;
        expect(workspace.stored.get("cody.suggestions.mode")).to.equal("off");
    });

    test("a refused write neither stops the others nor rejects, and is logged as a write error", async function () {
        workspace.rejected.add("chat.mcp.access");

        await restriction.apply();

        expect(workspace.stored.has("chat.mcp.access")).to.be.false;
        expect(workspace.stored.get("chat.disableAIFeatures")).to.equal(true);
        expect(warnings).to.deep.equal([
            "Could not write chat.mcp.access to turn off AI assistance.",
        ]);
    });

    test("touches nothing outside a course workspace", async function () {
        workspace.activeCourse = undefined;

        await restriction.apply();

        expect(workspace.writtenKeys).to.be.empty;
    });

    suite("refused writes", function () {
        test("are retried a while later, with nothing else changing", async function () {
            this.timeout(10_000);
            workspace.rejected.add("chat.mcp.access");
            await restriction.apply();

            workspace.rejected.clear();
            await wait(5_500);

            expect(workspace.stored.get("chat.mcp.access")).to.equal("none");
        });

        test("are retried as soon as the workspace file is saved or changed on disk", async function () {
            workspace.rejected.add("chat.mcp.access");
            await restriction.apply();

            workspace.rejected.clear();
            workspaceFileChanges.fire();
            await restriction.apply();

            expect(workspace.stored.get("chat.mcp.access")).to.equal("none");
        });

        test("do not count toward the backoff", async function () {
            workspace.rejected.add("chat.mcp.access");
            for (let i = 0; i < 8; i++) {
                await restriction.apply();
            }

            workspace.rejected.clear();
            await restriction.apply();

            expect(workspace.stored.get("chat.mcp.access")).to.equal("none");
            expect(warnings.filter((w) => w.startsWith("Something keeps"))).to.be.empty;
        });
    });

    suite("language overrides", function () {
        test("a user-scope language override is beaten by a workspace one of its own", async function () {
            holdEverySetting(workspace);
            workspace.user.set(keyOf(INLINE_SUGGEST, "python"), true);

            await restriction.apply();

            expect(workspace.writtenKeys).to.deep.equal([keyOf(INLINE_SUGGEST, "python")]);
            expect(workspace.inspectSetting(INLINE_SUGGEST, "python").effectiveValue).to.be.false;
        });

        test("a language outside the course languages is covered once something overrides it", async function () {
            holdEverySetting(workspace);
            workspace.user.set(keyOf(INLINE_SUGGEST, "haskell"), true);

            await restriction.apply();

            expect(workspace.stored.get(keyOf(INLINE_SUGGEST, "haskell"))).to.be.false;
        });

        test("a document opening in a language not seen before starts a pass that covers it", async function () {
            holdEverySetting(workspace);
            await restriction.apply();
            // A contributed language default, which no scope the student edits lists.
            workspace.defaults.set(keyOf(INLINE_SUGGEST, "ruby"), true);
            const document = await vscode.workspace.openTextDocument({ language: "ruby" });

            documentOpens.fire(document);
            await restriction.apply();

            expect(workspace.stored.get(keyOf(INLINE_SUGGEST, "ruby"))).to.be.false;
        });

        test("writes no language block where the workspace file's own value already wins", async function () {
            await restriction.apply();

            expect(workspace.writtenKeys.filter((key) => key.startsWith("["))).to.be.empty;
        });

        test("writes no language block while the top level does not hold", async function () {
            workspace.rejected.add(INLINE_SUGGEST);
            workspace.user.set(keyOf(INLINE_SUGGEST, "python"), true);

            await restriction.apply();

            expect(workspace.writtenKeys.filter((key) => key.startsWith("["))).to.be.empty;
        });
    });

    suite("exercise folders", function () {
        test("a folder setting that turns AI back on is overridden in that folder", async function () {
            holdEverySetting(workspace);
            workspace.folder.set(INLINE_SUGGEST, true);

            await restriction.apply();

            expect(workspace.writtenKeys).to.deep.equal([`folder:${INLINE_SUGGEST}`]);
            expect(workspace.folder.get(INLINE_SUGGEST)).to.be.false;
        });

        test("a folder language block that turns AI back on is overridden in that folder", async function () {
            holdEverySetting(workspace);
            workspace.folder.set(keyOf(INLINE_SUGGEST, "python"), true);

            await restriction.apply();

            expect(workspace.folder.get(keyOf(INLINE_SUGGEST, "python"))).to.be.false;
        });

        test("a folder that sets nothing is left untouched", async function () {
            await restriction.apply();

            expect(workspace.writtenKeys.filter((key) => key.startsWith("folder:"))).to.be.empty;
        });

        test("a newly found exercise folder starts a pass", async function () {
            holdEverySetting(workspace);
            workspace.folders = [];
            await restriction.apply();
            workspace.folder.set(INLINE_SUGGEST, true);
            workspace.folders = [EXERCISE_FOLDER];

            workspace.exercisesChanged.fire();
            await restriction.apply();

            expect(workspace.folder.get(INLINE_SUGGEST)).to.be.false;
        });
    });

    suite("live re-apply", function () {
        test("puts back a setting the student turned on", async function () {
            await restriction.apply();
            workspace.stored.set("chat.disableAIFeatures", false);

            configurationChanges.fire(changeOf("chat.disableAIFeatures"));
            await restriction.apply();

            expect(workspace.stored.get("chat.disableAIFeatures")).to.equal(true);
        });

        test("ignores a change to any other setting", async function () {
            configurationChanges.fire(changeOf("files.autoSave"));
            await wait(0);

            expect(workspace.writtenKeys).to.be.empty;
        });

        test("its own writes end in a pass that writes nothing, not a loop", async function () {
            workspace.onWrite = (section): void => configurationChanges.fire(changeOf(section));

            await restriction.apply();

            expect(workspace.writtenKeys).to.have.lengthOf(AI_SECTIONS.length);
        });

        test("a change during a pass waits for it instead of starting another alongside", async function () {
            workspace.writeDelayMs = 5;
            let isFirstInspect = true;
            // The earliest a pass can call back in: its first read, before anything is awaited.
            workspace.onInspect = (): void => {
                if (isFirstInspect) {
                    isFirstInspect = false;
                    configurationChanges.fire(changeOf("chat.agent.enabled"));
                }
            };

            await restriction.apply();

            expect(workspace.maxWritesInFlight).to.equal(1);
            expect(workspace.writtenKeys).to.have.lengthOf(AI_SECTIONS.length);
        });

        test("an installed or removed extension starts a pass", async function () {
            holdEverySetting(workspace);
            await restriction.apply();
            workspace.stored.set("chat.agent.enabled", true);

            extensionChanges.fire();
            await restriction.apply();

            expect(workspace.stored.get("chat.agent.enabled")).to.be.false;
        });
    });

    suite("dispose", function () {
        test("no pass runs after it", async function () {
            restriction.dispose();

            configurationChanges.fire(changeOf("chat.agent.enabled"));
            await restriction.apply();

            expect(workspace.writtenKeys).to.be.empty;
        });

        test("stops a pass in progress before its next write", async function () {
            workspace.onWrite = (): void => restriction.dispose();

            await restriction.apply();

            expect(workspace.writtenKeys).to.have.lengthOf(1);
        });

        test("cancels a pending retry", async function () {
            this.timeout(10_000);
            workspace.rejected.add("chat.mcp.access");
            await restriction.apply();
            restriction.dispose();

            workspace.rejected.clear();
            await wait(5_500);

            expect(workspace.stored.has("chat.mcp.access")).to.be.false;
        });
    });

    suite("backoff", function () {
        const FLAPPED = "chat.agent.enabled";

        /** Something that turns `FLAPPED` back on each time it is written, until stopped. */
        function flapUntilStopped(): () => void {
            let isFlapping = true;
            workspace.onWrite = (section): void => {
                if (isFlapping && section === FLAPPED) {
                    workspace.stored.set(section, true);
                    configurationChanges.fire(changeOf(section));
                }
            };
            return () => {
                isFlapping = false;
            };
        }

        setup(function () {
            holdEverySetting(workspace);
            workspace.stored.set(FLAPPED, true);
        });

        test("leaves a setting that keeps flipping back alone after a few writes", async function () {
            flapUntilStopped();

            await restriction.apply();

            expect(workspace.writtenKeys.filter((key) => key === FLAPPED)).to.have.lengthOf(5);
            expect(warnings.filter((w) => w.startsWith("Something keeps"))).to.have.lengthOf(1);
        });

        test("flapping one setting does not stop the others being put back", async function () {
            flapUntilStopped();
            await restriction.apply();

            workspace.stored.set("cody.suggestions.mode", "autocomplete");
            configurationChanges.fire(changeOf("cody.suggestions.mode"));
            await restriction.apply();

            expect(workspace.stored.get("cody.suggestions.mode")).to.equal("off");
            expect(workspace.stored.get(FLAPPED)).to.equal(true);
        });

        test("puts the setting back once its backoff ends, with nothing else changing", async function () {
            this.timeout(10_000);
            const stop = flapUntilStopped();
            await restriction.apply();
            stop();

            await wait(5_500);

            expect(workspace.stored.get(FLAPPED)).to.equal(false);
        });

        test("a write is counted before it is made, as it may restart the extension host", async function () {
            workspace.stored.set("chat.disableAIFeatures", false);
            let countedWrites: number | undefined;
            workspace.onWrite = (section): void => {
                if (section === "chat.disableAIFeatures") {
                    const backoffs =
                        state.get<Record<string, { writeTimes: number[] }>>(
                            "aiOffSettingsBackoffs",
                        );
                    countedWrites = backoffs?.["chat.disableAIFeatures"]?.writeTimes.length;
                }
            };

            await restriction.apply();

            expect(countedWrites).to.equal(1);
        });

        test("survives an extension host restart", async function () {
            flapUntilStopped();
            await restriction.apply();
            restriction.dispose();
            workspace.onWrite = (): void => {};
            const writesBeforeRestart = workspace.writtenKeys.length;

            restriction = createRestriction();
            await restriction.apply();

            expect(workspace.writtenKeys).to.have.lengthOf(writesBeforeRestart);
            expect(workspace.stored.get(FLAPPED)).to.equal(true);
        });
    });
});
