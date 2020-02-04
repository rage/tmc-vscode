import { Results } from "ts-results";
import * as vscode from "vscode";

import TMC from "../../api/tmc";
import Storage from "../../config/storage";
import { AuthenticationError } from "../../errors";
import { openFolder } from "../../utils";
import UI from "../ui";
import { HandlerContext } from "./types";

/**
 * Returns a handler that downloads given exercises and opens them in VSCode explorer, when called.
 * @param ui UI instance used for setting up the webview afterwards
 * @param tmc TMC API instance used for downloading exercises
 */
export function downloadExercises({ ui, tmc }: HandlerContext) {
    return async (msg: { type: string, ids: number[] }) => {
        ui.webview.setContentFromTemplate("loading");
        const results = Results(...await Promise.all(msg.ids.map((x) => tmc.downloadExercise(x))));
        if (results.ok) {
            console.log("opening downloaded exercises in: ", results.val);
            ui.webview.dispose();
            openFolder(...results.val.map((folderPath, index) =>
                ({ folderPath, name: msg.ids[index].toString() }))); // TODO: get proper exercise name from API
        } else {
            vscode.window.showErrorMessage("One or more exercise downloads failed.");
        }
    };
}

/**
 * Returns a handler that handles authentication with TMC server when called.
 * @param ui UI instance used for setting up the webview afterwards
 * @param storage Storage for storing authorization token on successful login
 * @param tmc TMC API instance used for downloading exercises
 */
export function handleLogin({ ui, storage, tmc, visibilityGroups }: HandlerContext) {
    return async (msg: { type: string, username: string, password: string }) => {
        console.log("Logging in as " + msg.username);
        const result = await tmc.authenticate(msg.username, msg.password);
        if (result.ok) {
            console.log("Logged in successfully");
            ui.treeDP.updateVisibility([visibilityGroups.LOGGED_IN]);
            storage.getOrganizationSlug() === undefined ? ui.treeDP.triggerCallback("orgs") : ui.treeDP.triggerCallback("index");
        } else {
            console.log("Login failed: " + result.val.message);
            if (result.val instanceof AuthenticationError) {
                console.log("auth error");
            }
            ui.webview.setContentFromTemplate("login", { error: result.val.message });
        }
    };
}

/**
 * Returns a handler that sets the current selected organization when called.
 * @param ui UI instance used for setting up the webview afterwards
 * @param storage Storage for updating currently selected organization
 */
export function setOrganization({ ui, storage, visibilityGroups }: HandlerContext) {
    return async (msg: { type: string, slug: string }) => {
        console.log("Organization selected:", msg.slug);
        storage.updateOrganizationSlug(msg.slug);
        ui.treeDP.updateVisibility([visibilityGroups.ORGANIZATION_CHOSEN]);
        ui.treeDP.triggerCallback("courses");
    };
}

/**
 * Returns a handler that sets the current selected course when called.
 * @param ui UI instance used for setting up the webview afterwards
 * @param storage Storage for updating currently selected organization
 */
export function setCourse({ ui, storage, visibilityGroups }: HandlerContext) {
    return async (msg: { type: string, id: number }) => {
        console.log("Course selected:", msg.id);
        storage.updateCourseId(msg.id);
        ui.treeDP.updateVisibility([visibilityGroups.COURSE_CHOSEN]);
        ui.treeDP.triggerCallback("courseDetails");
    };
}
