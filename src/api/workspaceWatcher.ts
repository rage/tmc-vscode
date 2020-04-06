import * as del from "del";
import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

import { ExerciseStatus, LocalExerciseData } from "../config/types";
import Resources from "../config/resources";
import { WORKSPACE_ROOT_FILE, WORKSPACE_ROOT_FILE_TEXT } from "../config/constants";
import WorkspaceManager from "./workspaceManager";

export default class WorkspaceWatcher {
    private readonly folderTree: Map<string, Map<string, Set<string>>> = new Map();
    private readonly resources: Resources;
    private readonly workspaceManager: WorkspaceManager;
    private watcher?: vscode.FileSystemWatcher;

    constructor(workspaceManager: WorkspaceManager, resources: Resources) {
        this.resources = resources;
        this.workspaceManager = workspaceManager;
        for (const exercise of workspaceManager.getAllExercises()) {
            if (exercise.status === ExerciseStatus.OPEN) {
                this.watch(exercise);
            }
        }
    }

    public start(): void {
        this.sweep();
        if (!this.watcher) {
            this.watcher = vscode.workspace.createFileSystemWatcher("**", false, false, false);
            this.watcher.onDidCreate((x) => {
                if (x.scheme === "file") {
                    this.fileCreateAction(x.fsPath);
                }
            });
            this.watcher.onDidDelete((x) => {
                if (x.scheme === "file") {
                    this.fileDeleteAction(x.fsPath);
                }
            });
            this.watcher.onDidChange((x) => {
                if (x.scheme === "file") {
                    this.fileChangeAction(x.fsPath);
                }
            });
        }
    }

    public stop(): void {
        this.watcher?.dispose();
        this.watcher = undefined;
    }

    public watch({ organization, course, name }: LocalExerciseData): void {
        if (!this.folderTree.has(organization)) {
            this.folderTree.set(organization, new Map());
        }
        if (!this.folderTree.get(organization)?.has(course)) {
            this.folderTree.get(organization)?.set(course, new Set());
        }
        this.folderTree
            .get(organization)
            ?.get(course)
            ?.add(name);
    }

    public unwatch({ organization, course, name }: LocalExerciseData): void {
        if (this.folderTree.get(organization)?.has(course)) {
            this.folderTree
                .get(organization)
                ?.get(course)
                ?.delete(name);
            if (this.folderTree.get(organization)?.get(course)?.size === 0) {
                this.folderTree.get(organization)?.delete(course);
                if (this.folderTree.get(organization)?.size === 0) {
                    this.folderTree.delete(organization);
                }
            }
        }
    }

    private sweep(): void {
        const basedir = this.resources.tmcExercisesFolderPath;

        fs.readdirSync(basedir, { withFileTypes: true }).forEach((organization) => {
            if (organization.isFile() && organization.name === WORKSPACE_ROOT_FILE) {
                if (
                    fs.readFileSync(path.join(basedir, organization.name), {
                        encoding: "utf-8",
                    }) !== WORKSPACE_ROOT_FILE_TEXT
                ) {
                    fs.writeFileSync(
                        path.join(basedir, organization.name),
                        WORKSPACE_ROOT_FILE_TEXT,
                        { encoding: "utf-8" },
                    );
                }
                return;
            } else if (!(organization.isDirectory() && this.folderTree.has(organization.name))) {
                del.sync(path.join(basedir, organization.name), { force: true });
            } else {
                fs.readdirSync(path.join(basedir, organization.name), {
                    withFileTypes: true,
                }).forEach((course) => {
                    if (
                        !(
                            this.folderTree.get(organization.name)?.has(course.name) &&
                            course.isDirectory()
                        )
                    ) {
                        del.sync(path.join(basedir, organization.name, course.name), {
                            force: true,
                        });
                    } else {
                        fs.readdirSync(path.join(basedir, organization.name, course.name), {
                            withFileTypes: true,
                        }).forEach((exercise) => {
                            if (
                                !(
                                    this.folderTree
                                        .get(organization.name)
                                        ?.get(course.name)
                                        ?.has(exercise.name) && exercise.isDirectory()
                                )
                            ) {
                                del.sync(
                                    path.join(
                                        basedir,
                                        organization.name,
                                        course.name,
                                        exercise.name,
                                    ),
                                    { force: true },
                                );
                            }
                        });
                    }
                });
            }
        });
    }

    private fileCreateAction(targetPath: string): void {
        const relation = path
            .relative(this.resources.tmcExercisesFolderPath, targetPath)
            .toString()
            .split(path.sep, 3);
        if (relation[0] === "..") {
            return;
        }
        if (
            relation.length > 0 &&
            !this.folderTree.has(relation[0]) &&
            relation[0] !== WORKSPACE_ROOT_FILE
        ) {
            del.sync(path.join(this.resources.tmcExercisesFolderPath, relation[0]), {
                force: true,
            });
            return;
        }
        if (relation.length > 1 && !this.folderTree.get(relation[0])?.has(relation[1])) {
            del.sync(path.join(this.resources.tmcExercisesFolderPath, relation[0], relation[1]), {
                force: true,
            });
            return;
        }
        if (
            relation.length > 2 &&
            !this.folderTree
                .get(relation[0])
                ?.get(relation[1])
                ?.has(relation[2])
        ) {
            del.sync(path.join(this.resources.tmcExercisesFolderPath, ...relation), {
                force: true,
            });
            return;
        }
    }

    /**
     * Marks exercise data as missing if deleted, missing exercises are treated the same
     * as closed exercises by the watcher
     */
    private fileDeleteAction(targetPath: string): void {
        const rootFilePath = path.join(this.resources.tmcExercisesFolderPath, WORKSPACE_ROOT_FILE);

        if (path.relative(rootFilePath, targetPath) === "") {
            fs.writeFileSync(targetPath, WORKSPACE_ROOT_FILE_TEXT, { encoding: "utf-8" });
            return;
        }

        const relation = path
            .relative(this.resources.tmcExercisesFolderPath, targetPath)
            .toString()
            .split(path.sep, 4);

        if (relation[0] === "..") {
            return;
        }
        if (relation.length == 1 && this.folderTree.has(relation[0])) {
            this.workspaceManager
                .getAllExercises()
                .filter((x) => x.organization === relation[0] && x.status === ExerciseStatus.OPEN)
                .forEach((x) => {
                    this.workspaceManager.setMissing(x.id);
                    this.unwatch(x);
                });
            return;
        }
        if (relation.length == 2 && this.folderTree.get(relation[0])?.has(relation[1])) {
            this.workspaceManager
                .getAllExercises()
                .filter(
                    (x) =>
                        x.organization === relation[0] &&
                        x.course === relation[1] &&
                        x.status === ExerciseStatus.OPEN,
                )
                .forEach((x) => {
                    this.workspaceManager.setMissing(x.id);
                    this.unwatch(x);
                });
            return;
        }
        if (
            relation.length == 3 &&
            this.folderTree
                .get(relation[0])
                ?.get(relation[1])
                ?.has(relation[2])
        ) {
            this.workspaceManager
                .getAllExercises()
                .filter(
                    (x) =>
                        x.organization === relation[0] &&
                        x.course === relation[1] &&
                        x.name === relation[2] &&
                        x.status === ExerciseStatus.OPEN,
                )
                .forEach((x) => {
                    this.workspaceManager.setMissing(x.id);
                    this.unwatch(x);
                });
            return;
        }
    }

    /**
     * Keeps the workspace root file in order
     */
    private fileChangeAction(targetPath: string): void {
        const rootFilePath = path.join(this.resources.tmcExercisesFolderPath, WORKSPACE_ROOT_FILE);

        if (path.relative(rootFilePath, targetPath) === "") {
            if (fs.readFileSync(rootFilePath, { encoding: "utf-8" }) !== WORKSPACE_ROOT_FILE_TEXT) {
                fs.writeFileSync(targetPath, WORKSPACE_ROOT_FILE_TEXT, { encoding: "utf-8" });
            }
        }
    }
}
